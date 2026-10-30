import ExpoModulesCore
import GameController
import UIKit

private enum ModifierState: String {
  case off
  case armed
  case locked
}

private struct KeyDescriptor {
  let key: String
  let code: String
}

private struct HardwareKeyPress {
  let key: String
  let code: String
  let ctrl: Bool
  let alt: Bool
  let shift: Bool
  let meta: Bool
}

private let hardwareRepeatDelay: TimeInterval = 0.4
private let hardwareRepeatInterval: TimeInterval = 0.033

private final class TerminalTextView: UITextView {
  var terminalAccessoryView: UIView?
  var onHardwareKey: ((UIKey) -> Bool)?
  var onHardwareKeyReleased: ((UIKey) -> Void)?
  var onEmptyDeleteBackward: (() -> Void)?
  var onPasteCommand: (() -> Void)?
  var onCopyCommand: (() -> Void)?

  // The text view only stages IME input; an undo stack would replay text the terminal already received.
  private let disabledUndoManager: UndoManager = {
    let manager = UndoManager()
    manager.disableUndoRegistration()
    return manager
  }()

  override var inputAccessoryView: UIView? {
    get {
      terminalAccessoryView
    }
    set {
      terminalAccessoryView = newValue
    }
  }

  override var undoManager: UndoManager? {
    disabledUndoManager
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(paste(_:)) {
      return UIPasteboard.general.hasStrings
    }
    if action == #selector(copy(_:)) {
      return true
    }
    return false
  }

  override func paste(_ sender: Any?) {
    onPasteCommand?()
  }

  override func copy(_ sender: Any?) {
    onCopyCommand?()
  }

  private var handledPresses = Set<UIPress>()

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var unhandled = presses
    for keyPress in presses {
      guard let key = keyPress.key, onHardwareKey?(key) == true else {
        continue
      }
      handledPresses.insert(keyPress)
      unhandled.remove(keyPress)
    }
    if !unhandled.isEmpty {
      super.pressesBegan(unhandled, with: event)
    }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandled = releasePresses(presses)
    if !unhandled.isEmpty {
      super.pressesEnded(unhandled, with: event)
    }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandled = releasePresses(presses)
    if !unhandled.isEmpty {
      super.pressesCancelled(unhandled, with: event)
    }
  }

  private func releasePresses(_ presses: Set<UIPress>) -> Set<UIPress> {
    var unhandled = presses
    for keyPress in presses where handledPresses.contains(keyPress) {
      handledPresses.remove(keyPress)
      unhandled.remove(keyPress)
      if let key = keyPress.key {
        onHardwareKeyReleased?(key)
      }
    }
    return unhandled
  }

  override func deleteBackward() {
    let shouldEmitBackspace = markedTextRange == nil && text.isEmpty
    super.deleteBackward()
    if shouldEmitBackspace {
      onEmptyDeleteBackward?()
    }
  }
}

private final class RepeatingButton: UIButton {
  var keyAction: ((Bool) -> Void)?
  var repeatsWhileHeld = false

  private var repeatStart: DispatchWorkItem?
  private var repeatTimer: Timer?
  private var repeatDidStart = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    addTarget(self, action: #selector(pressBegan), for: .touchDown)
    addTarget(self, action: #selector(pressActivated), for: .touchUpInside)
    addTarget(
      self,
      action: #selector(pressCancelled),
      for: [.touchUpOutside, .touchCancel, .touchDragExit]
    )
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
  }

  deinit {
    stopRepeating()
  }

  @objc private func pressBegan() {
    stopRepeating()
    repeatDidStart = false
    guard repeatsWhileHeld else {
      return
    }

    let start = DispatchWorkItem { [weak self] in
      guard let self, self.isTracking else {
        return
      }
      self.repeatDidStart = true
      self.keyAction?(false)
      let timer = Timer(timeInterval: 0.06, repeats: true) { [weak self] _ in
        self?.keyAction?(true)
      }
      self.repeatTimer = timer
      RunLoop.main.add(timer, forMode: .common)
    }
    repeatStart = start
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.42, execute: start)
  }

  @objc private func pressActivated() {
    if !repeatDidStart {
      keyAction?(false)
    }
    stopRepeating()
  }

  @objc private func pressCancelled() {
    stopRepeating()
  }

  private func stopRepeating() {
    repeatStart?.cancel()
    repeatStart = nil
    repeatTimer?.invalidate()
    repeatTimer = nil
  }
}

final class WmuxKeyInputView: ExpoView, UITextViewDelegate {
  let onKey = EventDispatcher()
  let onText = EventDispatcher()
  let onPaste = EventDispatcher()
  let onFocusChange = EventDispatcher()
  let onModifierState = EventDispatcher()
  let onCopy = EventDispatcher()
  let onHardwareKeyboardChange = EventDispatcher()

  var altSendsMeta = false

  private let textView = TerminalTextView()
  private var ctrlState = ModifierState.off
  private var altState = ModifierState.off
  private var lastCtrlTap: TimeInterval = 0
  private var lastAltTap: TimeInterval = 0
  private var ctrlButton: UIButton?
  private var altButton: UIButton?
  private var shouldAutoFocus = false
  private var isResettingText = false
  private var hardwareKeyboardConnected = false
  private var hardwareRepeatKeyCode: UIKeyboardHIDUsage?
  private var hardwareRepeatStart: DispatchWorkItem?
  private var hardwareRepeatTimer: Timer?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    isUserInteractionEnabled = false
    clipsToBounds = true

    textView.delegate = self
    textView.autocorrectionType = .no
    textView.spellCheckingType = .no
    textView.smartQuotesType = .no
    textView.smartDashesType = .no
    textView.smartInsertDeleteType = .no
    textView.autocapitalizationType = .none
    textView.keyboardAppearance = .dark
    textView.backgroundColor = .clear
    textView.textColor = .clear
    textView.tintColor = .clear
    textView.isScrollEnabled = false
    textView.isAccessibilityElement = false
    textView.inputAssistantItem.leadingBarButtonGroups = []
    textView.inputAssistantItem.trailingBarButtonGroups = []
    textView.terminalAccessoryView = buildAccessoryView()
    textView.onHardwareKey = { [weak self] key in
      self?.handleHardwareKey(key) ?? false
    }
    textView.onHardwareKeyReleased = { [weak self] key in
      self?.stopHardwareRepeat(keyCode: key.keyCode)
    }
    textView.onEmptyDeleteBackward = { [weak self] in
      self?.sendInputBackspace()
    }
    textView.onPasteCommand = { [weak self] in
      self?.onPaste(["text": UIPasteboard.general.string ?? ""])
    }
    textView.onCopyCommand = { [weak self] in
      self?.onCopy([:])
    }
    addSubview(textView)

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(hardwareKeyboardAvailabilityChanged),
      name: .GCKeyboardDidConnect,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(hardwareKeyboardAvailabilityChanged),
      name: .GCKeyboardDidDisconnect,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    stopHardwareRepeat()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
  }

  func setAutoFocus(_ value: Bool) {
    shouldAutoFocus = value
    if value, window != nil {
      focus()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else {
      stopHardwareRepeat()
      return
    }
    publishHardwareKeyboard(GCKeyboard.coalesced != nil, force: true)
    if shouldAutoFocus {
      focus()
    }
  }

  @objc private func hardwareKeyboardAvailabilityChanged() {
    DispatchQueue.main.async { [weak self] in
      self?.publishHardwareKeyboard(GCKeyboard.coalesced != nil)
    }
  }

  private func publishHardwareKeyboard(_ connected: Bool, force: Bool = false) {
    guard force || connected != hardwareKeyboardConnected else {
      return
    }
    hardwareKeyboardConnected = connected
    onHardwareKeyboardChange(["connected": connected])
  }

  func focus() {
    DispatchQueue.main.async { [weak self] in
      self?.textView.becomeFirstResponder()
    }
  }

  func blur() {
    stopHardwareRepeat()
    textView.resignFirstResponder()
  }

  func sendText(_ data: String) {
    guard !data.isEmpty else {
      return
    }
    let isModified = ctrlState != .off || altState != .off
    if isModified, data.count == 1 {
      sendKey(
        key: data,
        code: codeForCharacter(data),
        ctrl: ctrlState != .off,
        alt: altState != .off,
        shift: false,
        meta: false,
        repeatKey: false,
        source: "ime"
      )
      consumeArmedModifiers()
      return
    }
    onText(["data": data])
    consumeArmedModifiers()
  }

  func sendKey(
    key: String,
    code: String,
    ctrl: Bool,
    alt: Bool,
    shift: Bool,
    meta: Bool,
    repeatKey: Bool,
    source: String
  ) {
    let resolvedAlt = altSendsMeta && alt ? false : alt
    let resolvedMeta = meta || (altSendsMeta && alt)
    onKey([
      "key": key,
      "code": code,
      "ctrl": ctrl,
      "alt": resolvedAlt,
      "shift": shift,
      "meta": resolvedMeta,
      "repeat": repeatKey,
      "source": source
    ])
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onFocusChange(["focused": true])
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    stopHardwareRepeat()
    commitUnmarkedText()
    onFocusChange(["focused": false])
  }

  func textViewDidChange(_ textView: UITextView) {
    commitUnmarkedText()
  }

  func textView(
    _ textView: UITextView,
    shouldChangeTextIn range: NSRange,
    replacementText text: String
  ) -> Bool {
    guard textView.markedTextRange == nil, text == "\n" || text == "\r" || text == "\r\n" else {
      return true
    }
    sendKey(
      key: "Enter",
      code: "Enter",
      ctrl: ctrlState != .off,
      alt: altState != .off,
      shift: false,
      meta: false,
      repeatKey: false,
      source: "ime"
    )
    consumeArmedModifiers()
    return false
  }

  private func commitUnmarkedText() {
    guard !isResettingText, textView.markedTextRange == nil else {
      return
    }
    let committedText = textView.text ?? ""
    guard !committedText.isEmpty else {
      return
    }
    sendText(committedText)
    isResettingText = true
    textView.text = ""
    isResettingText = false
  }

  private func sendInputBackspace() {
    sendKey(
      key: "Backspace",
      code: "Backspace",
      ctrl: ctrlState != .off,
      alt: altState != .off,
      shift: false,
      meta: false,
      repeatKey: false,
      source: "ime"
    )
    consumeArmedModifiers()
  }

  private func handleHardwareKey(_ hardwareKey: UIKey) -> Bool {
    let hid = Int(hardwareKey.keyCode.rawValue)
    if isModifierHid(hid) {
      return false
    }
    // A physical key proves a hardware keyboard even where GameController reports none, such as the Simulator.
    publishHardwareKeyboard(true)

    let flags = hardwareKey.modifierFlags
    let ctrl = flags.contains(.control)
    let alt = flags.contains(.alternate)
    let shift = flags.contains(.shift)
    let meta = flags.contains(.command)

    // Command-C and Command-V travel through UIKit's edit actions so a keyboard paste is a user-initiated paste.
    if meta, !ctrl, !alt, hid == 0x06 || hid == 0x19 {
      return false
    }

    let descriptor = descriptorForHid(hid, fallback: hardwareKey.charactersIgnoringModifiers)
    let isModified = ctrl || alt || meta
    let isSpecial = descriptor.key.count > 1

    guard isModified || isSpecial else {
      stopHardwareRepeat()
      return false
    }

    let press = HardwareKeyPress(
      key: descriptor.key,
      code: descriptor.code,
      ctrl: ctrl,
      alt: alt,
      shift: shift,
      meta: meta
    )
    sendHardwareKey(press, repeatKey: false)
    if meta {
      stopHardwareRepeat()
    } else {
      startHardwareRepeat(press, keyCode: hardwareKey.keyCode)
    }
    return true
  }

  private func sendHardwareKey(_ press: HardwareKeyPress, repeatKey: Bool) {
    sendKey(
      key: press.key,
      code: press.code,
      ctrl: press.ctrl,
      alt: press.alt,
      shift: press.shift,
      meta: press.meta,
      repeatKey: repeatKey,
      source: "hardware"
    )
  }

  // UIKit does not repeat presses that bypass text input, so held terminal keys repeat here.
  private func startHardwareRepeat(_ press: HardwareKeyPress, keyCode: UIKeyboardHIDUsage) {
    stopHardwareRepeat()
    hardwareRepeatKeyCode = keyCode
    let start = DispatchWorkItem { [weak self] in
      guard let self, self.hardwareRepeatKeyCode == keyCode else {
        return
      }
      self.sendHardwareKey(press, repeatKey: true)
      let timer = Timer(timeInterval: hardwareRepeatInterval, repeats: true) { [weak self] _ in
        self?.sendHardwareKey(press, repeatKey: true)
      }
      self.hardwareRepeatTimer = timer
      RunLoop.main.add(timer, forMode: .common)
    }
    hardwareRepeatStart = start
    DispatchQueue.main.asyncAfter(deadline: .now() + hardwareRepeatDelay, execute: start)
  }

  private func stopHardwareRepeat(keyCode: UIKeyboardHIDUsage? = nil) {
    if let keyCode, keyCode != hardwareRepeatKeyCode {
      return
    }
    hardwareRepeatKeyCode = nil
    hardwareRepeatStart?.cancel()
    hardwareRepeatStart = nil
    hardwareRepeatTimer?.invalidate()
    hardwareRepeatTimer = nil
  }

  private func buildAccessoryView() -> UIView {
    let container = UIView(frame: CGRect(x: 0, y: 0, width: 0, height: 48))
    container.backgroundColor = UIColor(red: 0.055, green: 0.063, blue: 0.082, alpha: 1)
    container.autoresizingMask = [.flexibleWidth]

    let scrollView = UIScrollView()
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.alwaysBounceHorizontal = true
    scrollView.translatesAutoresizingMaskIntoConstraints = false

    let stack = UIStackView()
    stack.axis = .horizontal
    stack.alignment = .fill
    stack.distribution = .fill
    stack.spacing = 6
    stack.translatesAutoresizingMaskIntoConstraints = false

    let dismissButton = makeKeyButton(title: "⌄") { [weak self] _ in
      self?.blur()
    }
    dismissButton.accessibilityLabel = "Dismiss terminal keyboard"
    dismissButton.translatesAutoresizingMaskIntoConstraints = false

    container.addSubview(scrollView)
    container.addSubview(dismissButton)
    scrollView.addSubview(stack)
    NSLayoutConstraint.activate([
      container.heightAnchor.constraint(equalToConstant: 48),
      scrollView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: dismissButton.leadingAnchor, constant: -6),
      scrollView.topAnchor.constraint(equalTo: container.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      dismissButton.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -8),
      dismissButton.topAnchor.constraint(equalTo: container.topAnchor, constant: 5),
      dismissButton.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -5),
      dismissButton.widthAnchor.constraint(equalToConstant: 42),
      stack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 8),
      stack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -8),
      stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 5),
      stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -5),
      stack.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor, constant: -10)
    ])

    stack.addArrangedSubview(makeKeyButton(title: "Esc") { [weak self] _ in
      self?.sendAccessoryKey(key: "Escape", code: "Escape")
    })
    stack.addArrangedSubview(makeKeyButton(title: "Tab") { [weak self] _ in
      self?.sendAccessoryKey(key: "Tab", code: "Tab")
    })
    let pasteButton = makeKeyButton(title: "Paste") { [weak self] _ in
      self?.onPaste(["text": UIPasteboard.general.string ?? ""])
    }
    pasteButton.accessibilityLabel = "Paste into terminal"
    stack.addArrangedSubview(pasteButton)

    let ctrl = makeModifierButton(title: "Ctrl", action: #selector(toggleCtrl))
    ctrlButton = ctrl
    stack.addArrangedSubview(ctrl)
    let alt = makeModifierButton(title: "Alt", action: #selector(toggleAlt))
    altButton = alt
    stack.addArrangedSubview(alt)

    for descriptor in [
      KeyDescriptor(key: "ArrowLeft", code: "ArrowLeft"),
      KeyDescriptor(key: "ArrowUp", code: "ArrowUp"),
      KeyDescriptor(key: "ArrowDown", code: "ArrowDown"),
      KeyDescriptor(key: "ArrowRight", code: "ArrowRight")
    ] {
      let glyph = [
        "ArrowLeft": "←",
        "ArrowUp": "↑",
        "ArrowDown": "↓",
        "ArrowRight": "→"
      ][descriptor.key] ?? descriptor.key
      stack.addArrangedSubview(makeKeyButton(title: glyph, repeatable: true) { [weak self] repeatKey in
        self?.sendAccessoryKey(key: descriptor.key, code: descriptor.code, repeatKey: repeatKey)
      })
    }

    for literal in ["|", "/", "~", "-", "_", "`"] {
      stack.addArrangedSubview(makeKeyButton(title: literal) { [weak self] _ in
        self?.sendText(literal)
      })
    }

    return container
  }

  private func makeKeyButton(
    title: String,
    repeatable: Bool = false,
    action: @escaping (Bool) -> Void
  ) -> RepeatingButton {
    let button = RepeatingButton(type: .system)
    button.keyAction = action
    button.repeatsWhileHeld = repeatable
    button.accessibilityLabel = title
    button.setTitle(title, for: .normal)
    button.setTitleColor(UIColor(red: 0.85, green: 0.87, blue: 0.91, alpha: 1), for: .normal)
    button.titleLabel?.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .semibold)
    button.backgroundColor = UIColor(red: 0.12, green: 0.14, blue: 0.18, alpha: 1)
    button.layer.cornerRadius = 7
    button.widthAnchor.constraint(greaterThanOrEqualToConstant: 42).isActive = true
    return button
  }

  private func makeModifierButton(title: String, action: Selector) -> UIButton {
    let button = makeKeyButton(title: title) { _ in }
    button.addGestureRecognizer(UITapGestureRecognizer(target: self, action: action))
    return button
  }

  @objc private func toggleCtrl() {
    let now = ProcessInfo.processInfo.systemUptime
    let doubleTap = ctrlState == .armed && now - lastCtrlTap <= 0.3
    ctrlState = doubleTap ? .locked : ctrlState == .off ? .armed : .off
    lastCtrlTap = ctrlState == .armed ? now : 0
    publishModifierState()
  }

  @objc private func toggleAlt() {
    let now = ProcessInfo.processInfo.systemUptime
    let doubleTap = altState == .armed && now - lastAltTap <= 0.3
    altState = doubleTap ? .locked : altState == .off ? .armed : .off
    lastAltTap = altState == .armed ? now : 0
    publishModifierState()
  }

  private func sendAccessoryKey(key: String, code: String, repeatKey: Bool = false) {
    sendKey(
      key: key,
      code: code,
      ctrl: ctrlState != .off,
      alt: altState != .off,
      shift: false,
      meta: false,
      repeatKey: repeatKey,
      source: "accessory"
    )
    consumeArmedModifiers()
  }

  private func consumeArmedModifiers() {
    var changed = false
    if ctrlState == .armed {
      ctrlState = .off
      changed = true
    }
    if altState == .armed {
      altState = .off
      changed = true
    }
    if changed {
      publishModifierState()
    }
  }

  private func publishModifierState() {
    updateModifierButton(ctrlButton, title: "Ctrl", state: ctrlState)
    updateModifierButton(altButton, title: "Alt", state: altState)
    onModifierState(["ctrl": ctrlState.rawValue, "alt": altState.rawValue])
  }

  private func updateModifierButton(_ button: UIButton?, title: String, state: ModifierState) {
    let suffix = state == .locked ? " •" : ""
    button?.setTitle("\(title)\(suffix)", for: .normal)
    button?.backgroundColor = state == .off
      ? UIColor(red: 0.12, green: 0.14, blue: 0.18, alpha: 1)
      : UIColor(red: 0.98, green: 0.62, blue: 0.25, alpha: 1)
    button?.setTitleColor(
      state == .off
        ? UIColor(red: 0.85, green: 0.87, blue: 0.91, alpha: 1)
        : UIColor(red: 0.04, green: 0.05, blue: 0.07, alpha: 1),
      for: .normal
    )
  }
}

private func isModifierHid(_ hid: Int) -> Bool {
  hid == 0x39 || (0xE0...0xE7).contains(hid)
}

private func descriptorForHid(_ hid: Int, fallback: String) -> KeyDescriptor {
  let special: [Int: KeyDescriptor] = [
    0x28: KeyDescriptor(key: "Enter", code: "Enter"),
    0x29: KeyDescriptor(key: "Escape", code: "Escape"),
    0x2A: KeyDescriptor(key: "Backspace", code: "Backspace"),
    0x2B: KeyDescriptor(key: "Tab", code: "Tab"),
    0x3A: KeyDescriptor(key: "F1", code: "F1"),
    0x3B: KeyDescriptor(key: "F2", code: "F2"),
    0x3C: KeyDescriptor(key: "F3", code: "F3"),
    0x3D: KeyDescriptor(key: "F4", code: "F4"),
    0x3E: KeyDescriptor(key: "F5", code: "F5"),
    0x3F: KeyDescriptor(key: "F6", code: "F6"),
    0x40: KeyDescriptor(key: "F7", code: "F7"),
    0x41: KeyDescriptor(key: "F8", code: "F8"),
    0x42: KeyDescriptor(key: "F9", code: "F9"),
    0x43: KeyDescriptor(key: "F10", code: "F10"),
    0x44: KeyDescriptor(key: "F11", code: "F11"),
    0x45: KeyDescriptor(key: "F12", code: "F12"),
    0x49: KeyDescriptor(key: "Insert", code: "Insert"),
    0x4A: KeyDescriptor(key: "Home", code: "Home"),
    0x4B: KeyDescriptor(key: "PageUp", code: "PageUp"),
    0x4C: KeyDescriptor(key: "Delete", code: "Delete"),
    0x4D: KeyDescriptor(key: "End", code: "End"),
    0x4E: KeyDescriptor(key: "PageDown", code: "PageDown"),
    0x4F: KeyDescriptor(key: "ArrowRight", code: "ArrowRight"),
    0x50: KeyDescriptor(key: "ArrowLeft", code: "ArrowLeft"),
    0x51: KeyDescriptor(key: "ArrowDown", code: "ArrowDown"),
    0x52: KeyDescriptor(key: "ArrowUp", code: "ArrowUp")
  ]
  if let descriptor = special[hid] {
    return descriptor
  }
  return KeyDescriptor(key: fallback, code: codeForHid(hid, fallback: fallback))
}

private func codeForHid(_ hid: Int, fallback: String) -> String {
  if (0x04...0x1D).contains(hid) {
    let scalar = UnicodeScalar(65 + hid - 0x04)
    return "Key\(Character(scalar!))"
  }
  if (0x1E...0x26).contains(hid) {
    return "Digit\(hid - 0x1D)"
  }
  if hid == 0x27 {
    return "Digit0"
  }
  let punctuation: [Int: String] = [
    0x2C: "Space",
    0x2D: "Minus",
    0x2E: "Equal",
    0x2F: "BracketLeft",
    0x30: "BracketRight",
    0x31: "Backslash",
    0x33: "Semicolon",
    0x34: "Quote",
    0x35: "Backquote",
    0x36: "Comma",
    0x37: "Period",
    0x38: "Slash"
  ]
  return punctuation[hid] ?? codeForCharacter(fallback)
}

private func codeForCharacter(_ value: String) -> String {
  guard let character = value.first else {
    return ""
  }
  if character.isLetter {
    return "Key\(String(character).uppercased())"
  }
  if character.isNumber {
    return "Digit\(character)"
  }
  let punctuation: [Character: String] = [
    " ": "Space",
    "-": "Minus",
    "_": "Minus",
    "=": "Equal",
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    "|": "Backslash",
    ";": "Semicolon",
    "'": "Quote",
    "`": "Backquote",
    "~": "Backquote",
    ",": "Comma",
    ".": "Period",
    "/": "Slash"
  ]
  return punctuation[character] ?? ""
}
