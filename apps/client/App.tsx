import { useEffect, useMemo, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import bs58 from "bs58";
import { MAX_PROMPT_SIZE } from "@localllm/protocol";
import { WorkletBridge } from "./src/services/workletBridge";
import type { WorkletEvent } from "./src/types/bridge";

type Screen = "connect" | "scanner" | "chat";

type ConnectionState = "disconnected" | "connecting" | "connected";

type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  aborted?: boolean;
};

function parseServerId(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate) {
    return null;
  }

  try {
    const decoded = bs58.decode(candidate);
    return decoded.length === 32 ? candidate : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("connect");
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [connectionError, setConnectionError] = useState<string | null>(null);
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

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const transcriptScroll = useRef<ScrollView | null>(null);
  const activeAssistant = useRef<{ requestId: string | null; index: number } | null>(null);
  const bridgeRef = useRef<WorkletBridge | null>(null);

  const promptLength = prompt.trim().length;
  const promptTooLong = promptLength > MAX_PROMPT_SIZE;
  const isPromptEmpty = promptLength === 0;

  useEffect(() => {
    const bridge = new WorkletBridge();
    bridgeRef.current = bridge;

    bridge.onEvent((event: WorkletEvent) => {
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
        const matchesActiveRequest =
          !!active &&
          (active.requestId === event.requestId || active.requestId === null);

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
        }
        setIsGenerating(false);
        return;
      }

      if (event.type === "onError") {
        if (event.code === "TIMEOUT_NO_RESPONSE") {
          setConnectionError("Connection timed out");
        } else {
          setConnectionError(`${event.code}: ${event.message}`);
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
          setIsGenerating(false);
        }
        return;
      }

      if (event.type === "onDisconnect") {
        setConnectionState("disconnected");
        setIsGenerating(false);
        activeAssistant.current = null;

        if (event.code === "HOST_DISCONNECTED") {
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
      bridge.destroy();
      bridgeRef.current = null;
    };
  }, []);

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
    setIsGenerating(false);
    activeAssistant.current = null;
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
    if (!normalized || promptTooLong || connectionState !== "connected" || isGenerating) {
      return;
    }

    setTranscript((previous) => {
      const assistantIndex = previous.length + 1;
      activeAssistant.current = { requestId: null, index: assistantIndex };
      return [...previous, { role: "user", text: normalized }, { role: "assistant", text: "" }];
    });

    setIsGenerating(true);
    setConnectionError(null);
    setPrompt("");
    bridgeRef.current?.sendPrompt(normalized);
  };

  const onAbortPress = () => {
    if (!isGenerating) {
      return;
    }

    bridgeRef.current?.abort();
  };

  const onClearPress = () => {
    setTranscript([]);
    activeAssistant.current = null;
  };

  const openScanner = async () => {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();

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

  const sendDisabled = isGenerating || promptTooLong || isPromptEmpty || connectionState !== "connected";

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
        style={styles.input}
      />

      <View style={styles.row}>
        <Pressable
          style={[styles.button, styles.primaryButton, connectionState === "connecting" ? styles.disabled : null]}
          onPress={onConnectPress}
          disabled={connectionState === "connecting"}
        >
          <Text style={styles.primaryButtonText}>Connect</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={openScanner}>
          <Text style={styles.secondaryButtonText}>Scan QR</Text>
        </Pressable>
      </View>

      {connectionState === "connecting" ? <ActivityIndicator style={styles.loader} /> : null}
      <Text style={styles.status}>{statusText}</Text>
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
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.host}>{hostName ?? "Host"}</Text>
          <Text style={styles.model}>Model: {modelName ?? "-"}</Text>
        </View>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={onDisconnectPress}>
          <Text style={styles.secondaryButtonText}>Disconnect</Text>
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

      <ScrollView ref={transcriptScroll} style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {transcript.length === 0 ? <Text style={styles.empty}>No messages yet.</Text> : null}
        {transcript.map((entry, index) => {
          const isActiveAssistantMessage =
            entry.role === "assistant" &&
            isGenerating &&
            activeAssistant.current?.index === index;
          const renderedText =
            entry.role === "assistant" && entry.aborted
              ? `${entry.text ? `${entry.text} ` : ""}[Aborted]`
              : entry.text;

          return (
            <View key={`${entry.role}-${index}`} style={styles.message}>
              <Text style={styles.messageRole}>{entry.role.toUpperCase()}</Text>
              <View style={styles.messageBody}>
                {renderedText ? <Text style={styles.messageText}>{renderedText}</Text> : null}
                {isActiveAssistantMessage ? (
                  <ActivityIndicator size="small" color="#4b578f" />
                ) : null}
                {!renderedText && !isActiveAssistantMessage ? (
                  <Text style={styles.messageText}>...</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <TextInput
        value={prompt}
        onChangeText={setPrompt}
        editable={!isGenerating && connectionState === "connected"}
        multiline
        placeholder="Ask something..."
        style={styles.promptInput}
      />

      {promptTooLong ? (
        <Text style={styles.errorText}>
          Prompt exceeds {MAX_PROMPT_SIZE} characters. Shorten it to send.
        </Text>
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
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {screen === "connect" ? renderConnectScreen() : null}
      {screen === "scanner" ? renderScannerScreen() : null}
      {screen === "chat" ? renderChatScreen() : null}
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  status: {
    fontWeight: "600",
    color: "#1d2a63",
  },
  errorText: {
    color: "#a01536",
    fontWeight: "600",
  },
  loader: {
    marginTop: 8,
  },
  scanner: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    overflow: "hidden",
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
  empty: {
    color: "#5f6899",
  },
  message: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e0e6ff",
    backgroundColor: "#f8f9ff",
    gap: 4,
  },
  messageRole: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4b578f",
  },
  messageText: {
    color: "#1b1f3a",
    lineHeight: 20,
  },
  messageBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
