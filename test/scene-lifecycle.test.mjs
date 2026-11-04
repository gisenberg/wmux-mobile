import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { adoptSceneLifecycle } = require("../plugins/with-scene-lifecycle.js");

const templateAppDelegate = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

test("the scene plugin hands window creation to the Expo scene delegate", () => {
  const adopted = adoptSceneLifecycle(templateAppDelegate);
  assert.match(adopted, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider \{/);
  assert.doesNotMatch(adopted, /UIWindow\(frame:/);
  assert.doesNotMatch(adopted, /startReactNative/);
  assert.equal(adoptSceneLifecycle(adopted), adopted);
});

test("the scene plugin fails loudly when the Expo template changes", () => {
  assert.throws(
    () => adoptSceneLifecycle(templateAppDelegate.replace("factory.startReactNative(", "factory.start(")),
    /template changed/,
  );
});
