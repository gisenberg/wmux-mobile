import { requireNativeView } from "expo";
import { forwardRef } from "react";
import type { RefAttributes } from "react";

import type { WmuxKeyInputRef, WmuxKeyInputViewProps } from "./WmuxKeyInput.types";

type NativeProps = WmuxKeyInputViewProps & RefAttributes<WmuxKeyInputRef>;

const NativeWmuxKeyInputView = requireNativeView<NativeProps>("WmuxKeyInput");

export const WmuxKeyInputView = forwardRef<WmuxKeyInputRef, WmuxKeyInputViewProps>(
  function WmuxKeyInputView(props, ref) {
    return <NativeWmuxKeyInputView {...props} ref={ref} />;
  },
);
