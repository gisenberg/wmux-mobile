package expo.modules.wmuxkeyinput

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WmuxKeyInputModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WmuxKeyInput")

    View(WmuxKeyInputView::class) {
      Events("onKey", "onText", "onPaste", "onFocusChange", "onModifierState")

      Prop("altSendsMeta") { view: WmuxKeyInputView, value: Boolean ->
        view.altSendsMeta = value
      }

      Prop("autoFocus") { view: WmuxKeyInputView, value: Boolean ->
        view.setAutoFocus(value)
      }

      AsyncFunction("focus") { view: WmuxKeyInputView ->
        view.focusInput()
      }

      AsyncFunction("blur") { view: WmuxKeyInputView ->
        view.blurInput()
      }

      AsyncFunction("sendKey") {
        view: WmuxKeyInputView,
        key: String,
        code: String,
        ctrl: Boolean,
        alt: Boolean,
        shift: Boolean,
        meta: Boolean ->
        view.emitKey(key, code, ctrl, alt, shift, meta, false, "accessory")
      }

      AsyncFunction("sendText") { view: WmuxKeyInputView, data: String ->
        view.emitText(data)
      }

      AsyncFunction("startKeyRepeat") {
        view: WmuxKeyInputView,
        key: String,
        code: String,
        ctrl: Boolean,
        alt: Boolean,
        shift: Boolean,
        meta: Boolean ->
        view.startKeyRepeat(key, code, ctrl, alt, shift, meta)
      }

      AsyncFunction("stopKeyRepeat") { view: WmuxKeyInputView ->
        view.stopKeyRepeat()
      }
    }
  }
}
