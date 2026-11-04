// Adopts the UIScene life cycle that the iOS 27 SDK requires: iOS 27 traps at launch in
// _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption for apps built against it without a scene manifest.
// Expo SDK 57 ships ExpoAppSceneDelegate but its project template still creates the window in the app delegate,
// so this applies the SDK 58 template's wiring. Remove it once the template adopts scenes itself.
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const sceneDelegateClass = "EXExpoAppSceneDelegate";

const replaceOnce = (contents, search, replacement, description) => {
  if (contents.includes(replacement)) return contents;
  if (!contents.includes(search)) {
    throw new Error(
      `with-scene-lifecycle could not find ${description} in AppDelegate.swift; the Expo template changed, so ` +
        "check whether it now adopts the scene life cycle and remove plugins/with-scene-lifecycle.js",
    );
  }
  return contents.replace(search, replacement);
};

const adoptSceneLifecycle = (source) => {
  let contents = source;
  contents = replaceOnce(
    contents,
    "class AppDelegate: ExpoAppDelegate {",
    "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
    "the AppDelegate declaration",
  );
  contents = replaceOnce(
    contents,
    `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`,
    `    // The scene delegate creates the window and starts React Native under the scene life cycle.
`,
    "the window and React Native startup",
  );
  return contents;
};

const withSceneAppDelegate = (config) =>
  withAppDelegate(config, (modConfig) => {
    if (modConfig.modResults.language !== "swift") {
      throw new Error("with-scene-lifecycle only supports a Swift AppDelegate");
    }
    modConfig.modResults.contents = adoptSceneLifecycle(modConfig.modResults.contents);
    return modConfig;
  });

const withSceneManifest = (config) =>
  withInfoPlist(config, (modConfig) => {
    modConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: sceneDelegateClass,
          },
        ],
      },
    };
    return modConfig;
  });

module.exports = (config) => withSceneManifest(withSceneAppDelegate(config));
module.exports.adoptSceneLifecycle = adoptSceneLifecycle;
