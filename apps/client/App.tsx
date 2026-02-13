import { useEffect, useMemo, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { ErrorCode, MAX_PROMPT_SIZE } from "@localllm/protocol";
import { WorkletBridge } from "./src/services/workletBridge";
import type { WorkletEvent } from "./src/types/bridge";
import { isSendDisabled, parseServerId } from "./src/utils/inputValidation";

type Screen = "connect" | "scanner" | "chat" | "debug";

type ConnectionState = "disconnected" | "connecting" | "connected";

type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  aborted?: boolean;
};

const MAX_DEBUG_LOG_ENTRIES = 300;

export default function App() {
  const [screen, setScreen] = useState<Screen>("connect");
  const [displayedScreen, setDisplayedScreen] = useState<Screen>("connect");
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [serverIdInput, setServerIdInput] = useState("");
  const [lastServerId, setLastServerId] = useState<string | null>(null);
  const [hostName, setHostName] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDisconnectedBanner, setShowDisconnectedBanner] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [reconnectCooldownSec, setReconnectCooldownSec] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [rawMessageLog, setRawMessageLog] = useState<string[]>([]);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const transcriptScroll = useRef<ScrollView | null>(null);
  const promptInputRef = useRef<TextInput | null>(null);
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const activeAssistant = useRef<{ requestId: string | null; index: number } | null>(null);
  const lastServerIdRef = useRef<string | null>(null);
  const bridgeRef = useRef<WorkletBridge | null>(null);
  const hostTapCount = useRef(0);
  const hostTapResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendLockRef = useRef(false);
  const connectionStateRef = useRef<ConnectionState>("disconnected");

  const promptByteLength = new TextEncoder().encode(prompt.trim()).byteLength;
  const promptTooLong = promptByteLength > MAX_PROMPT_SIZE;

  const appendRawMessage = (line: string) => {
    setRawMessageLog((previous) => {
      const next = [...previous, line];
      if (next.length <= MAX_DEBUG_LOG_ENTRIES) {
        return next;
      }

      return next.slice(next.length - MAX_DEBUG_LOG_ENTRIES);
    });
  };

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    const bridge = new WorkletBridge();
    bridgeRef.current = bridge;

    bridge.onEvent((event: WorkletEvent) => {
      if (event.type === "onRawMessage") {
        if (event.direction === "out" && activeAssistant.current?.requestId === null) {
          try {
            const parsed = JSON.parse(event.text) as { type?: string; request_id?: string };
            if (parsed.type === "chat_start" && typeof parsed.request_id === "string") {
              activeAssistant.current = {
                requestId: parsed.request_id,
                index: activeAssistant.current.index,
              };
            }
          } catch {
            // Keep raw-message logging resilient to malformed debug payloads.
          }
        }

        const timestamp = new Date().toLocaleTimeString();
        appendRawMessage(`${timestamp} ${event.direction.toUpperCase()} ${event.text}`);
        return;
      }

      if (event.type === "onServerInfo") {
        setHostName(event.hostName);
        setModelName(event.model);
        setConnectionState("connected");
        setConnectionError(null);
        setShowDisconnectedBanner(false);
        setScreen("chat");
        return;
      }

      if (event.type === "onChunk") {
        setTranscript((previous) => {
          if (activeAssistant.current && activeAssistant.current.requestId === event.requestId) {
            const next = [...previous];
            const target = next[activeAssistant.current.index];
            if (target) {
              next[activeAssistant.current.index] = {
                ...target,
                text: `${target.text}${event.text}`,
              };
            }
            return next;
          }

          if (activeAssistant.current && activeAssistant.current.requestId === null) {
            const next = [...previous];
            const target = next[activeAssistant.current.index];
            if (target) {
              next[activeAssistant.current.index] = {
                ...target,
                text: `${target.text}${event.text}`,
              };
            }
            activeAssistant.current = {
              requestId: event.requestId,
              index: activeAssistant.current.index,
            };
            return next;
          }

          activeAssistant.current = {
            requestId: event.requestId,
            index: previous.length,
          };
          return [...previous, { role: "assistant", text: event.text }];
        });
        return;
      }

      if (event.type === "onChatEnd") {
        const active = activeAssistant.current;
        const matchesActiveRequest = !!active && active.requestId === event.requestId;

        if (matchesActiveRequest && event.finishReason === "abort" && active) {
          setTranscript((previous) => {
            const next = [...previous];
            const target = next[active.index];
            if (target && target.role === "assistant") {
              next[active.index] = {
                ...target,
                aborted: true,
              };
            }
            return next;
          });
        }

        if (matchesActiveRequest) {
          activeAssistant.current = null;
          sendLockRef.current = false;
          setIsGenerating(false);
        }
        return;
      }

      if (event.type === "onError") {
        const nextError =
          event.code === ErrorCode.TIMEOUT_NO_RESPONSE ? "Connection timed out" : `${event.code}: ${event.message}`;

        setConnectionError(nextError);
        setLastError(nextError);
        if (connectionStateRef.current === "connecting") {
          setConnectionState("disconnected");
        }

        if (event.requestId && activeAssistant.current?.requestId === event.requestId) {
          setTranscript((previous) => {
            const targetIndex = activeAssistant.current?.index;
            if (targetIndex === undefined) {
              return previous;
            }

            const next = [...previous];
            const target = next[targetIndex];
            if (target && !target.text) {
              next[targetIndex] = {
                ...target,
                text: `[${event.code}] ${event.message}`,
              };
            }
            return next;
          });
          activeAssistant.current = null;
          sendLockRef.current = false;
          setIsGenerating(false);
        }
        return;
      }

      if (event.type === "onDisconnect") {
        setConnectionState("disconnected");
        setIsGenerating(false);
        sendLockRef.current = false;
        activeAssistant.current = null;

        if (event.code !== ErrorCode.USER_DISCONNECTED) {
          setLastError(`${event.code}: ${event.message}`);
          if (lastServerIdRef.current) {
            setServerIdInput(lastServerIdRef.current);
          }
        }

        if (event.code === ErrorCode.HOST_DISCONNECTED) {
          setShowDisconnectedBanner(true);
          setConnectionError(null);
          setScreen("chat");
        } else {
          setShowDisconnectedBanner(false);
          setScreen("connect");
        }
      }
    });

    return () => {
      if (hostTapResetTimer.current) {
        clearTimeout(hostTapResetTimer.current);
      }
      bridge.destroy();
      bridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const shouldAnimateMainScreenTransition =
      (screen === "connect" || screen === "chat") &&
      (displayedScreen === "connect" || displayedScreen === "chat") &&
      screen !== displayedScreen;

    if (!shouldAnimateMainScreenTransition) {
      setDisplayedScreen(screen);
      screenOpacity.setValue(1);
      return;
    }

    Animated.timing(screenOpacity, {
      toValue: 0,
      duration: 130,
      useNativeDriver: true,
    }).start(() => {
      setDisplayedScreen(screen);
      Animated.timing(screenOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    });
  }, [displayedScreen, screen, screenOpacity]);

  useEffect(() => {
    transcriptScroll.current?.scrollToEnd({ animated: true });
  }, [transcript]);

  useEffect(() => {
    if (reconnectCooldownSec <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      setReconnectCooldownSec((previous) => Math.max(0, previous - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [reconnectCooldownSec]);

  const statusText = useMemo(() => {
    if (connectionState === "connecting") {
      return "Connecting...";
    }

    if (connectionState === "connected") {
      return "Connected";
    }

    return "Disconnected";
  }, [connectionState]);

  const connectToServer = (serverId: string) => {
    const parsed = parseServerId(serverId);
    if (!parsed) {
      Alert.alert("Invalid Server ID", "Server ID must be a valid base58 value decoding to 32 bytes.");
      return;
    }

    setConnectionState("connecting");
    setConnectionError(null);
    setShowDisconnectedBanner(false);
    setLastServerId(parsed);
    lastServerIdRef.current = parsed;
    setServerIdInput(parsed);
    setScreen("connect");

    bridgeRef.current?.connect(parsed);
  };

  const onConnectPress = () => {
    connectToServer(serverIdInput);
  };

  const onDisconnectPress = () => {
    bridgeRef.current?.disconnect();
    setConnectionState("disconnected");
    setConnectionError(null);
    setShowDisconnectedBanner(false);
    setIsGenerating(false);
    sendLockRef.current = false;
    activeAssistant.current = null;
    setScreen("connect");
  };

  const onReconnectPress = () => {
    if (!lastServerId || reconnectCooldownSec > 0) {
      return;
    }

    setReconnectCooldownSec(3);
    connectToServer(lastServerId);
  };

  const onSendPrompt = () => {
    const normalized = prompt.trim();
    if (!normalized || promptTooLong || connectionState !== "connected" || isGenerating || sendLockRef.current) {
      return;
    }
    sendLockRef.current = true;

    setTranscript((previous) => {
      const assistantIndex = previous.length + 1;
      activeAssistant.current = { requestId: null, index: assistantIndex };
      return [...previous, { role: "user", text: normalized }, { role: "assistant", text: "" }];
    });

    setRequestCount((previous) => previous + 1);
    setIsGenerating(true);
    setConnectionError(null);
    setPrompt("");
    bridgeRef.current?.sendPrompt(normalized);
    requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  };

  const onAbortPress = () => {
    if (!isGenerating) {
      return;
    }

    sendLockRef.current = false;
    setIsGenerating(false);
    bridgeRef.current?.abort();
  };

  const onClearPress = () => {
    setTranscript([]);
    activeAssistant.current = null;
  };

  const onHostHeaderPress = () => {
    if (connectionState !== "connected") {
      return;
    }

    hostTapCount.current += 1;

    if (hostTapResetTimer.current) {
      clearTimeout(hostTapResetTimer.current);
    }

    hostTapResetTimer.current = setTimeout(() => {
      hostTapCount.current = 0;
      hostTapResetTimer.current = null;
    }, 2000);

    if (hostTapCount.current >= 5) {
      hostTapCount.current = 0;
      if (hostTapResetTimer.current) {
        clearTimeout(hostTapResetTimer.current);
        hostTapResetTimer.current = null;
      }
      setScreen("debug");
    }
  };

  const openScanner = async () => {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();

    if (!permission.granted) {
      Alert.alert("Camera denied", "Camera permission is required for QR scanning.");
      return;
    }

    setScannerLocked(false);
    setScreen("scanner");
  };

  const onQrScanned = (result: BarcodeScanningResult) => {
    if (scannerLocked) {
      return;
    }

    setScannerLocked(true);

    const parsed = parseServerId(result.data);
    if (!parsed) {
      Alert.alert("Invalid QR", "The scanned QR does not contain a valid base58 Server ID.");
      setScannerLocked(false);
      return;
    }

    setScreen("connect");
    connectToServer(parsed);
  };

  const sendDisabled = isSendDisabled({
    connectionState,
    isGenerating,
    prompt,
  });

  const renderConnectScreen = () => (
    <View style={styles.screen}>
      <Text style={styles.title}>LocalLLM Client</Text>
      <Text style={styles.label}>Server ID</Text>
      <TextInput
        value={serverIdInput}
        onChangeText={setServerIdInput}
        placeholder="Paste base58 Server ID"
        autoCapitalize="none"
        autoCorrect={false}
        editable={connectionState !== "connecting"}
        style={[styles.input, styles.connectInput]}
      />

      <View style={styles.row}>
        <Pressable
          style={[styles.button, styles.primaryButton, connectionState === "connecting" ? styles.disabled : null]}
          onPress={onConnectPress}
          disabled={connectionState === "connecting"}
        >
          <Text style={styles.primaryButtonText}>Connect</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.scanButton, connectionState === "connecting" ? styles.disabled : null]}
          onPress={openScanner}
          disabled={connectionState === "connecting"}
        >
          <Text style={styles.scanButtonText}>Scan QR</Text>
        </Pressable>
      </View>

      {connectionState === "connecting" ? (
        <View style={styles.connectingRow}>
          <ActivityIndicator style={styles.loader} size="small" color="#2448d6" />
          <Text style={styles.connectingText}>Connecting...</Text>
        </View>
      ) : (
        <Text style={styles.status}>{statusText}</Text>
      )}
      {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}
    </View>
  );

  const renderScannerScreen = () => (
    <View style={styles.screen}>
      <Text style={styles.title}>Scan Server QR</Text>
      <CameraView
        style={styles.scanner}
        facing="back"
        onBarcodeScanned={onQrScanned}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      />
      <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => setScreen("connect")}>
        <Text style={styles.secondaryButtonText}>Back</Text>
      </Pressable>
    </View>
  );

  const renderChatScreen = () => (
    <KeyboardAvoidingView
      style={styles.chatKeyboardContainer}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={12}
    >
      <View style={styles.screen}>
        <View style={styles.chatHeaderBar}>
          <Pressable style={styles.headerMeta} onPress={onHostHeaderPress}>
            <Text style={styles.host}>{hostName ?? "Host"}</Text>
            <Text style={styles.model}>{modelName ?? "-"}</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.disconnectButton]} onPress={onDisconnectPress}>
            <Text style={styles.disconnectButtonText}>Disconnect</Text>
          </Pressable>
        </View>

        {showDisconnectedBanner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Disconnected</Text>
            <Pressable
              style={[
                styles.button,
                styles.primaryButton,
                reconnectCooldownSec > 0 || connectionState === "connecting" ? styles.disabled : null,
              ]}
              onPress={onReconnectPress}
              disabled={reconnectCooldownSec > 0 || connectionState === "connecting"}
            >
              <Text style={styles.primaryButtonText}>
                {reconnectCooldownSec > 0 ? `Reconnect (${reconnectCooldownSec}s)` : "Reconnect"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          ref={transcriptScroll}
          style={styles.transcript}
          contentContainerStyle={[
            styles.transcriptContent,
            transcript.length === 0 ? styles.transcriptEmptyContent : null,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {transcript.length === 0 ? (
            <Text style={styles.empty}>Connected to {hostName ?? "host"}. Ask anything.</Text>
          ) : null}

          {transcript.map((entry, index) => {
            const isActiveAssistantMessage =
              entry.role === "assistant" && isGenerating && activeAssistant.current?.index === index;
            const renderedText =
              entry.role === "assistant" && entry.aborted ? `${entry.text ? `${entry.text} ` : ""}[Aborted]` : entry.text;

            return (
              <View
                key={`${entry.role}-${index}`}
                style={[
                  styles.messageRow,
                  entry.role === "user" ? styles.userMessageRow : styles.assistantMessageRow,
                ]}
              >
                <View
                  style={[
                    styles.messageBubble,
                    entry.role === "user" ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  {renderedText ? (
                    <Text style={[styles.messageText, entry.role === "user" ? styles.userMessageText : null]}>
                      {renderedText}
                    </Text>
                  ) : null}
                  {isActiveAssistantMessage ? <ActivityIndicator size="small" color="#2d3d7a" /> : null}
                  {!renderedText && !isActiveAssistantMessage ? <Text style={styles.messageText}>...</Text> : null}
                </View>
              </View>
            );
          })}
        </ScrollView>

        <TextInput
          ref={promptInputRef}
          value={prompt}
          onChangeText={setPrompt}
          editable={connectionState === "connected"}
          multiline
          autoFocus
          placeholder="Ask something..."
          style={styles.promptInput}
        />

        {promptTooLong ? (
          <Text style={styles.errorText}>Prompt exceeds {MAX_PROMPT_SIZE} bytes (UTF-8). Shorten it to send.</Text>
        ) : null}
        {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}

        <View style={styles.row}>
          <Pressable
            style={[styles.button, styles.primaryButton, sendDisabled ? styles.disabled : null]}
            onPress={onSendPrompt}
            disabled={sendDisabled}
          >
            <Text style={styles.primaryButtonText}>Send</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.secondaryButton, !isGenerating ? styles.disabled : null]}
            onPress={onAbortPress}
            disabled={!isGenerating}
          >
            <Text style={styles.secondaryButtonText}>Stop</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={onClearPress}>
            <Text style={styles.secondaryButtonText}>Clear</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  const renderDebugScreen = () => (
    <View style={styles.screen}>
      <Text style={styles.title}>Client Debug</Text>

      <View style={styles.debugCard}>
        <Text style={styles.debugRow}>Connection: {connectionState}</Text>
        <Text style={styles.debugRow}>Server ID: {lastServerId ?? "-"}</Text>
        <Text style={styles.debugRow}>Request count: {requestCount}</Text>
        <Text style={styles.debugRow}>Last error: {lastError ?? "None"}</Text>
      </View>

      <View style={styles.debugLogCard}>
        <Text style={styles.label}>Raw Message Log</Text>
        <ScrollView
          style={styles.debugLog}
          contentContainerStyle={styles.debugLogContent}
          keyboardShouldPersistTaps="handled"
        >
          {rawMessageLog.length === 0 ? <Text style={styles.empty}>No raw messages yet.</Text> : null}
          {rawMessageLog.map((entry, index) => (
            <Text key={`${index}-${entry.slice(0, 12)}`} style={styles.debugLogLine}>
              {entry}
            </Text>
          ))}
        </ScrollView>
      </View>

      <Pressable style={[styles.button, styles.primaryButton]} onPress={() => setScreen("chat")}>
        <Text style={styles.primaryButtonText}>Close</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {displayedScreen === "connect" || displayedScreen === "chat" ? (
        <Animated.View style={[styles.screenTransitionContainer, { opacity: screenOpacity }]}>
          {displayedScreen === "connect" ? renderConnectScreen() : renderChatScreen()}
        </Animated.View>
      ) : null}
      {displayedScreen === "scanner" ? renderScannerScreen() : null}
      {displayedScreen === "debug" ? renderDebugScreen() : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },
  screen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 12,
  },
  chatKeyboardContainer: {
    flex: 1,
  },
  screenTransitionContainer: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1b1f3a",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#30355c",
  },
  input: {
    borderWidth: 1,
    borderColor: "#c7cced",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  connectInput: {
    borderWidth: 1.5,
    borderColor: "#b8c4ff",
  },
  promptInput: {
    borderWidth: 1,
    borderColor: "#c7cced",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
    maxHeight: 160,
    textAlignVertical: "top",
    backgroundColor: "#ffffff",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  primaryButton: {
    backgroundColor: "#2448d6",
  },
  secondaryButton: {
    backgroundColor: "#e3e8ff",
  },
  scanButton: {
    backgroundColor: "#f8faff",
    borderWidth: 1.5,
    borderColor: "#b8c4ff",
  },
  disconnectButton: {
    backgroundColor: "#ffe2e8",
  },
  disabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButtonText: {
    color: "#1d2a63",
    fontWeight: "600",
  },
  scanButtonText: {
    color: "#2140be",
    fontWeight: "700",
  },
  disconnectButtonText: {
    color: "#8a1434",
    fontWeight: "700",
  },
  status: {
    fontWeight: "600",
    color: "#1d2a63",
  },
  errorText: {
    color: "#a01536",
    fontWeight: "600",
  },
  loader: {
    marginTop: 0,
  },
  connectingRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  connectingText: {
    color: "#2140be",
    fontWeight: "700",
  },
  scanner: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  chatHeaderBar: {
    borderWidth: 1,
    borderColor: "#cdd5fb",
    backgroundColor: "#eef2ff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  headerMeta: {
    flex: 1,
  },
  host: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1b1f3a",
  },
  model: {
    color: "#434d83",
    marginTop: 2,
  },
  banner: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#ffe9ef",
    borderWidth: 1,
    borderColor: "#f4bfd0",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bannerTitle: {
    color: "#8d1534",
    fontWeight: "700",
  },
  transcript: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#c7cced",
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  transcriptContent: {
    padding: 12,
    gap: 8,
  },
  transcriptEmptyContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  empty: {
    color: "#5f6899",
    textAlign: "center",
    fontWeight: "600",
  },
  messageRow: {
    width: "100%",
  },
  userMessageRow: {
    alignItems: "flex-end",
  },
  assistantMessageRow: {
    alignItems: "flex-start",
  },
  messageBubble: {
    maxWidth: "85%",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  userBubble: {
    backgroundColor: "#2448d6",
    borderColor: "#2448d6",
  },
  assistantBubble: {
    backgroundColor: "#f2f5ff",
    borderColor: "#dbe4ff",
  },
  messageText: {
    color: "#1b1f3a",
    lineHeight: 20,
  },
  userMessageText: {
    color: "#ffffff",
  },
  debugCard: {
    borderWidth: 1,
    borderColor: "#d2d8f2",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 8,
  },
  debugRow: {
    color: "#1f2751",
    fontWeight: "500",
  },
  debugLogCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d2d8f2",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 8,
  },
  debugLog: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: "#0f1221",
  },
  debugLogContent: {
    padding: 10,
    gap: 6,
  },
  debugLogLine: {
    color: "#d7e0ff",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
  },
});
