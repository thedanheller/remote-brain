import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { BareSwarmTransport } from "./src/services/bareSwarmTransport";
import { ProtocolClient } from "./src/services/protocolClient";
import type { ConnectionStatus, TranscriptEntry } from "./src/types/client";

function appendSystemMessage(setter: Dispatch<SetStateAction<TranscriptEntry[]>>, text: string) {
  setter((prev) => [
    ...prev,
    {
      id: `sys-${Date.now()}-${Math.random()}`,
      role: "system",
      text,
    },
  ]);
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionStatus>({ state: "disconnected" });
  const [serverIdInput, setServerIdInput] = useState("");
  const [hostName, setHostName] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const clientRef = useRef<ProtocolClient | null>(null);
  const assistantByRequest = useRef<Map<string, string>>(new Map());
  const transcriptScroll = useRef<ScrollView | null>(null);

  useEffect(() => {
    const transport = new BareSwarmTransport();
    const client = new ProtocolClient(transport, {
      onConnectionState: (state, message) => {
        setConnection({ state, message });

        if (state !== "connected") {
          setIsGenerating(false);
        }
      },
      onEvent: (event) => {
        if (event.type === "server_info") {
          setHostName(event.message.payload.host_name);
          setModelName(event.message.payload.model);
          return;
        }

        if (event.type === "chat_chunk") {
          const assistantId = assistantByRequest.current.get(event.requestId);
          if (!assistantId) {
            return;
          }

          setTranscript((prev) =>
            prev.map((entry) =>
              entry.id === assistantId ? { ...entry, text: `${entry.text}${event.text}` } : entry,
            ),
          );
          return;
        }

        if (event.type === "chat_end") {
          assistantByRequest.current.delete(event.message.request_id);
          setIsGenerating(false);
          return;
        }

        if (event.type === "error") {
          const errorMessage = `${event.message.payload.code}: ${event.message.payload.message}`;
          appendSystemMessage(setTranscript, errorMessage);
          if (event.message.request_id) {
            assistantByRequest.current.delete(event.message.request_id);
          }
          setIsGenerating(false);
          return;
        }

        if (event.type === "timeout") {
          appendSystemMessage(setTranscript, "TIMEOUT_NO_RESPONSE: No response from host in 30 seconds");
          assistantByRequest.current.delete(event.requestId);
          setIsGenerating(false);
          return;
        }

        if (event.type === "bad_message") {
          appendSystemMessage(setTranscript, `BAD_MESSAGE: ${event.error}`);
        }
      },
    });

    clientRef.current = client;

    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    transcriptScroll.current?.scrollToEnd({ animated: true });
  }, [transcript]);

  const canShowChat = connection.state === "connected" && Boolean(hostName && modelName);

  const statusLabel = useMemo(() => {
    if (connection.state === "error") {
      return connection.message ?? "Connection error";
    }

    if (connection.state === "connecting") {
      return "Connecting...";
    }

    if (connection.state === "connected") {
      return "Connected";
    }

    return "Disconnected";
  }, [connection]);

  const connect = () => {
    const serverId = serverIdInput.trim();
    if (!serverId) {
      Alert.alert("Missing Server ID", "Paste or scan a Server ID first.");
      return;
    }

    setHostName(null);
    setModelName(null);
    setTranscript([]);
    assistantByRequest.current.clear();
    clientRef.current?.connect(serverId);
  };

  const disconnect = () => {
    clientRef.current?.disconnect();
    setHostName(null);
    setModelName(null);
    setTranscript([]);
    setIsGenerating(false);
    assistantByRequest.current.clear();
  };

  const sendPrompt = () => {
    const text = prompt.trim();
    if (!text) {
      return;
    }

    const result = clientRef.current?.sendChatStart(text);
    if (!result) {
      return;
    }

    if (!result.ok) {
      appendSystemMessage(setTranscript, result.error);
      return;
    }

    const userId = `user-${result.requestId}`;
    const assistantId = `assistant-${result.requestId}`;

    assistantByRequest.current.set(result.requestId, assistantId);
    setTranscript((prev) => [
      ...prev,
      { id: userId, role: "user", text },
      { id: assistantId, role: "assistant", text: "" },
    ]);
    setPrompt("");
    setIsGenerating(true);
  };

  const stopGeneration = () => {
    clientRef.current?.abort();
    setIsGenerating(false);
    appendSystemMessage(setTranscript, "Abort requested");
  };

  const clearTranscript = () => {
    assistantByRequest.current.clear();
    setTranscript([]);
    setPrompt("");
  };

  const onQrScanned = (result: BarcodeScanningResult) => {
    if (!showScanner) {
      return;
    }

    setServerIdInput(result.data);
    setShowScanner(false);
  };

  const requestCamera = async () => {
    const response = await requestPermission();
    if (!response.granted) {
      Alert.alert("Camera denied", "Camera permission is required for QR scan.");
      return;
    }

    setShowScanner(true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {!canShowChat ? (
        <View style={styles.screen}>
          <Text style={styles.title}>LocalLLM Client</Text>
          <Text style={styles.label}>Server ID</Text>
          <TextInput
            value={serverIdInput}
            onChangeText={setServerIdInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste base58 Server ID"
            style={styles.input}
            editable={connection.state !== "connecting"}
          />
          <View style={styles.row}>
            <Pressable
              onPress={connect}
              style={[styles.button, styles.primaryButton]}
              disabled={connection.state === "connecting"}
            >
              <Text style={styles.primaryButtonText}>Connect</Text>
            </Pressable>
            <Pressable onPress={requestCamera} style={[styles.button, styles.secondaryButton]}>
              <Text style={styles.secondaryButtonText}>Scan QR</Text>
            </Pressable>
          </View>

          {connection.state === "connecting" ? <ActivityIndicator style={styles.loader} /> : null}
          <Text style={[styles.status, connection.state === "error" ? styles.errorText : null]}>
            {statusLabel}
          </Text>

          {showScanner ? (
            <View style={styles.scannerWrap}>
              {permission?.granted ? (
                <CameraView
                  style={styles.scanner}
                  facing="back"
                  onBarcodeScanned={onQrScanned}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                />
              ) : (
                <Text style={styles.errorText}>Camera permission not granted.</Text>
              )}
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => setShowScanner(false)}>
                <Text style={styles.secondaryButtonText}>Close Scanner</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.screen}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.host}>{hostName}</Text>
              <Text style={styles.model}>Model: {modelName}</Text>
            </View>
            <Pressable onPress={disconnect} style={[styles.button, styles.secondaryButton]}>
              <Text style={styles.secondaryButtonText}>Disconnect</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={transcriptScroll}
            style={styles.transcript}
            contentContainerStyle={styles.transcriptContent}
          >
            {transcript.map((entry) => (
              <View key={entry.id} style={styles.message}>
                <Text style={styles.messageRole}>{entry.role.toUpperCase()}</Text>
                <Text style={styles.messageText}>{entry.text || "..."}</Text>
              </View>
            ))}
          </ScrollView>

          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Ask something..."
            style={styles.promptInput}
            editable={!isGenerating}
            multiline
          />

          <View style={styles.row}>
            <Pressable onPress={sendPrompt} style={[styles.button, styles.primaryButton]} disabled={isGenerating}>
              <Text style={styles.primaryButtonText}>Send</Text>
            </Pressable>
            <Pressable
              onPress={stopGeneration}
              style={[styles.button, styles.secondaryButton]}
              disabled={!isGenerating}
            >
              <Text style={styles.secondaryButtonText}>Stop</Text>
            </Pressable>
            <Pressable onPress={clearTranscript} style={[styles.button, styles.secondaryButton]}>
              <Text style={styles.secondaryButtonText}>Clear</Text>
            </Pressable>
          </View>
        </View>
      )}
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
  },
  loader: {
    marginTop: 8,
  },
  scannerWrap: {
    marginTop: 8,
    gap: 10,
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
});
