package expo.modules.wmuxkeyinput

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.SpannableStringBuilder
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.ExtractedText
import android.view.inputmethod.ExtractedTextRequest
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.text.InputType
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class WmuxKeyInputView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onKey by EventDispatcher<Map<String, Any>>()
  private val onText by EventDispatcher<Map<String, String>>()
  private val onPaste by EventDispatcher<Map<String, String>>()
  private val onFocusChange by EventDispatcher<Map<String, Boolean>>()
  private val onModifierState by EventDispatcher<Map<String, String>>()

  var altSendsMeta = false
  private var shouldAutoFocus = false
  private val keyRepeatHandler = Handler(Looper.getMainLooper())
  private var keyRepeatAction: Runnable? = null

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    alpha = 0.01f
  }

  fun setAutoFocus(value: Boolean) {
    shouldAutoFocus = value
    if (value && isAttachedToWindow) {
      focusInput()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (shouldAutoFocus) {
      focusInput()
    }
  }

  override fun onDetachedFromWindow() {
    stopKeyRepeat()
    super.onDetachedFromWindow()
  }

  fun focusInput() {
    requestFocus()
    post {
      val manager = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      manager.restartInput(this)
      manager.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  fun blurInput() {
    stopKeyRepeat()
    val manager = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    manager.hideSoftInputFromWindow(windowToken, 0)
    clearFocus()
  }

  override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: android.graphics.Rect?) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    onFocusChange(mapOf("focused" to gainFocus))
  }

  override fun onCheckIsTextEditor(): Boolean = true

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
    outAttrs.inputType =
      InputType.TYPE_CLASS_TEXT or
        InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
        InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or
        InputType.TYPE_TEXT_FLAG_MULTI_LINE
    outAttrs.imeOptions =
      EditorInfo.IME_ACTION_NONE or
        EditorInfo.IME_FLAG_NO_EXTRACT_UI or
        EditorInfo.IME_FLAG_NO_FULLSCREEN or
        EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
    outAttrs.initialSelStart = 0
    outAttrs.initialSelEnd = 0
    return TerminalInputConnection(this)
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean =
    if (handleKeyEvent(event)) true else super.onKeyDown(keyCode, event)

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean =
    if (isModifierOnly(keyCode) || descriptorForKeyCode(keyCode) != null) true else super.onKeyUp(keyCode, event)

  internal fun handleKeyEvent(event: KeyEvent): Boolean {
    if (event.action != KeyEvent.ACTION_DOWN || isModifierOnly(event.keyCode)) {
      return isModifierOnly(event.keyCode)
    }

    val descriptor = descriptorForKeyCode(event.keyCode)
    val ctrl = event.isCtrlPressed
    val alt = event.isAltPressed
    val shift = event.isShiftPressed || event.isCapsLockOn
    val meta = event.isMetaPressed

    if (descriptor != null) {
      emitKey(descriptor.first, descriptor.second, ctrl, alt, shift, meta, event.repeatCount > 0, "hardware")
      return true
    }

    val unicode = event.unicodeChar
    if (unicode == 0) {
      return false
    }
    val text = String(Character.toChars(unicode))
    if (ctrl || alt || meta) {
      emitKey(text, codeForCharacter(text), ctrl, alt, shift, meta, event.repeatCount > 0, "hardware")
    } else {
      emitText(text)
    }
    return true
  }

  fun emitText(data: String) {
    if (data.isNotEmpty()) {
      onText(mapOf("data" to data))
    }
  }

  fun emitKey(
    key: String,
    code: String,
    ctrl: Boolean,
    alt: Boolean,
    shift: Boolean,
    meta: Boolean,
    repeatKey: Boolean,
    source: String
  ) {
    val resolvedAlt = if (altSendsMeta && alt) false else alt
    val resolvedMeta = meta || (altSendsMeta && alt)
    onKey(
      mapOf(
        "key" to key,
        "code" to code,
        "ctrl" to ctrl,
        "alt" to resolvedAlt,
        "shift" to shift,
        "meta" to resolvedMeta,
        "repeat" to repeatKey,
        "source" to source
      )
    )
  }

  fun startKeyRepeat(
    key: String,
    code: String,
    ctrl: Boolean,
    alt: Boolean,
    shift: Boolean,
    meta: Boolean
  ) {
    stopKeyRepeat()
    emitKey(key, code, ctrl, alt, shift, meta, false, "accessory")
    val action =
      object : Runnable {
        override fun run() {
          emitKey(key, code, ctrl, alt, shift, meta, true, "accessory")
          keyRepeatHandler.postDelayed(this, 60L)
        }
      }
    keyRepeatAction = action
    keyRepeatHandler.postDelayed(action, 60L)
  }

  fun stopKeyRepeat() {
    keyRepeatAction?.let(keyRepeatHandler::removeCallbacks)
    keyRepeatAction = null
  }

  private inner class TerminalInputConnection(targetView: View) : BaseInputConnection(targetView, true) {
    private val editable = SpannableStringBuilder()
    private var composingText: String? = null

    override fun getEditable(): Editable = editable

    override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
      val committed = text?.toString().orEmpty()
      composingText = null
      editable.clear()
      emitText(committed)
      return true
    }

    override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
      composingText = text?.toString().orEmpty()
      editable.replace(0, editable.length, composingText)
      return true
    }

    override fun setComposingRegion(start: Int, end: Int): Boolean = true

    override fun finishComposingText(): Boolean {
      val committed = composingText
      composingText = null
      editable.clear()
      if (!committed.isNullOrEmpty()) {
        emitText(committed)
      }
      return true
    }

    override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
      if (!composingText.isNullOrEmpty()) {
        composingText = null
        editable.clear()
        return true
      }
      repeat(beforeLength.coerceAtLeast(1)) {
        emitKey("Backspace", "Backspace", false, false, false, false, it > 0, "ime")
      }
      return true
    }

    override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean =
      deleteSurroundingText(beforeLength, afterLength)

    override fun sendKeyEvent(event: KeyEvent): Boolean = handleKeyEvent(event)

    override fun performEditorAction(actionCode: Int): Boolean {
      emitKey("Enter", "Enter", false, false, false, false, false, "ime")
      return true
    }

    override fun performContextMenuAction(id: Int): Boolean = false

    override fun getTextBeforeCursor(length: Int, flags: Int): CharSequence =
      editable.takeLast(length.coerceAtMost(editable.length))

    override fun getTextAfterCursor(length: Int, flags: Int): CharSequence = ""

    override fun getSelectedText(flags: Int): CharSequence = ""

    override fun getExtractedText(request: ExtractedTextRequest?, flags: Int): ExtractedText =
      ExtractedText().apply {
        text = editable
        startOffset = 0
        partialStartOffset = -1
        partialEndOffset = -1
        selectionStart = editable.length
        selectionEnd = editable.length
        this.flags = 0
      }

    override fun commitCompletion(text: android.view.inputmethod.CompletionInfo?): Boolean = false

    override fun commitCorrection(correctionInfo: android.view.inputmethod.CorrectionInfo?): Boolean = false

    override fun performPrivateCommand(action: String?, data: Bundle?): Boolean = false

    override fun clearMetaKeyStates(states: Int): Boolean = true

    override fun setSelection(start: Int, end: Int): Boolean = true

    override fun beginBatchEdit(): Boolean = true

    override fun endBatchEdit(): Boolean = true
  }
}

private fun descriptorForKeyCode(keyCode: Int): Pair<String, String>? =
  when (keyCode) {
    KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "Enter" to "Enter"
    KeyEvent.KEYCODE_ESCAPE -> "Escape" to "Escape"
    KeyEvent.KEYCODE_DEL -> "Backspace" to "Backspace"
    KeyEvent.KEYCODE_FORWARD_DEL -> "Delete" to "Delete"
    KeyEvent.KEYCODE_TAB -> "Tab" to "Tab"
    KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft" to "ArrowLeft"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight" to "ArrowRight"
    KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp" to "ArrowUp"
    KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown" to "ArrowDown"
    KeyEvent.KEYCODE_MOVE_HOME -> "Home" to "Home"
    KeyEvent.KEYCODE_MOVE_END -> "End" to "End"
    KeyEvent.KEYCODE_PAGE_UP -> "PageUp" to "PageUp"
    KeyEvent.KEYCODE_PAGE_DOWN -> "PageDown" to "PageDown"
    KeyEvent.KEYCODE_INSERT -> "Insert" to "Insert"
    KeyEvent.KEYCODE_F1 -> "F1" to "F1"
    KeyEvent.KEYCODE_F2 -> "F2" to "F2"
    KeyEvent.KEYCODE_F3 -> "F3" to "F3"
    KeyEvent.KEYCODE_F4 -> "F4" to "F4"
    KeyEvent.KEYCODE_F5 -> "F5" to "F5"
    KeyEvent.KEYCODE_F6 -> "F6" to "F6"
    KeyEvent.KEYCODE_F7 -> "F7" to "F7"
    KeyEvent.KEYCODE_F8 -> "F8" to "F8"
    KeyEvent.KEYCODE_F9 -> "F9" to "F9"
    KeyEvent.KEYCODE_F10 -> "F10" to "F10"
    KeyEvent.KEYCODE_F11 -> "F11" to "F11"
    KeyEvent.KEYCODE_F12 -> "F12" to "F12"
    else -> null
  }

private fun isModifierOnly(keyCode: Int): Boolean =
  keyCode == KeyEvent.KEYCODE_CTRL_LEFT ||
    keyCode == KeyEvent.KEYCODE_CTRL_RIGHT ||
    keyCode == KeyEvent.KEYCODE_ALT_LEFT ||
    keyCode == KeyEvent.KEYCODE_ALT_RIGHT ||
    keyCode == KeyEvent.KEYCODE_SHIFT_LEFT ||
    keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT ||
    keyCode == KeyEvent.KEYCODE_META_LEFT ||
    keyCode == KeyEvent.KEYCODE_META_RIGHT

private fun codeForCharacter(value: String): String {
  val character = value.firstOrNull() ?: return ""
  if (character.isLetter()) {
    return "Key${character.uppercaseChar()}"
  }
  if (character.isDigit()) {
    return "Digit$character"
  }
  return when (character) {
    ' ' -> "Space"
    '-', '_' -> "Minus"
    '=' -> "Equal"
    '[' -> "BracketLeft"
    ']' -> "BracketRight"
    '\\', '|' -> "Backslash"
    ';' -> "Semicolon"
    '\'' -> "Quote"
    '`', '~' -> "Backquote"
    ',' -> "Comma"
    '.' -> "Period"
    '/' -> "Slash"
    else -> ""
  }
}
