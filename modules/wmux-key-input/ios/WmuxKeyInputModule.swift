import ExpoModulesCore

public final class WmuxKeyInputModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WmuxKeyInput")

    View(WmuxKeyInputView.self) {
      Events("onKey", "onText", "onPaste", "onFocusChange", "onModifierState")

      Prop("altSendsMeta") { (view: WmuxKeyInputView, value: Bool) in
        view.altSendsMeta = value
      }

      Prop("autoFocus") { (view: WmuxKeyInputView, value: Bool) in
        view.setAutoFocus(value)
      }

      AsyncFunction("focus") { (view: WmuxKeyInputView) in
        view.focus()
      }

      AsyncFunction("blur") { (view: WmuxKeyInputView) in
        view.blur()
      }

      AsyncFunction("sendKey") {
        (
          view: WmuxKeyInputView,
          key: String,
          code: String,
          ctrl: Bool,
          alt: Bool,
          shift: Bool,
          meta: Bool
        ) in
        view.sendKey(
          key: key,
          code: code,
          ctrl: ctrl,
          alt: alt,
          shift: shift,
          meta: meta,
          repeatKey: false,
          source: "accessory"
        )
      }

      AsyncFunction("sendText") { (view: WmuxKeyInputView, data: String) in
        view.sendText(data)
      }

      AsyncFunction("startKeyRepeat") {
        (
          view: WmuxKeyInputView,
          key: String,
          code: String,
          ctrl: Bool,
          alt: Bool,
          shift: Bool,
          meta: Bool
        ) in
        view.sendKey(
          key: key,
          code: code,
          ctrl: ctrl,
          alt: alt,
          shift: shift,
          meta: meta,
          repeatKey: true,
          source: "accessory"
        )
      }

      AsyncFunction("stopKeyRepeat") { (_: WmuxKeyInputView) in }
    }
  }
}
