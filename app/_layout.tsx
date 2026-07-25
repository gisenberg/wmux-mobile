import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { colors } from "@/ui/theme";

export default function RootLayout() {
  return (
    <KeyboardProvider preload={false}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            animation: "none",
            contentStyle: { backgroundColor: colors.canvas },
            headerShown: false,
          }}
        />
      </GestureHandlerRootView>
    </KeyboardProvider>
  );
}
