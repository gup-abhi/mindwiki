const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withAppDelegate,
  withGradleProperties,
  withMainActivity,
} = require('@expo/config-plugins')

const FLAG_MARKER = '// @mindwiki/privacy FLAG_SECURE'
const IOS_MARKER = '// @mindwiki/privacy APP_SWITCHER_OVERLAY'

function addAndroidFlagSecure(contents, language) {
  if (contents.includes(FLAG_MARKER)) return contents
  if (language !== 'kt') throw new Error('MindWiki privacy plugin requires Kotlin MainActivity')
  const importAnchor = 'import android.os.Bundle'
  const onCreateAnchor = 'override fun onCreate(savedInstanceState: Bundle?) {'
  if (!contents.includes(importAnchor) || !contents.includes(onCreateAnchor)) {
    throw new Error('MindWiki privacy plugin: unsupported MainActivity template')
  }
  return contents
    .replace(importAnchor, `${importAnchor}\nimport android.view.WindowManager`)
    .replace(
      onCreateAnchor,
      `${onCreateAnchor}\n    ${FLAG_MARKER}\n    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)`
    )
}

function addIosPrivacyOverlay(contents, language) {
  if (contents.includes(IOS_MARKER)) return contents
  if (language !== 'objcpp' && language !== 'objc') {
    throw new Error('MindWiki privacy plugin requires Objective-C AppDelegate')
  }
  const implementation = '@implementation AppDelegate'
  const end = '\n@end'
  if (!contents.includes(implementation) || !contents.includes(end)) {
    throw new Error('MindWiki privacy plugin: unsupported AppDelegate template')
  }
  const property = `${IOS_MARKER}\n@interface AppDelegate ()\n@property(nonatomic, strong) UIWindow *mindwikiPrivacyWindow;\n@end\n\n${implementation}`
  const methods = `

- (void)applicationWillResignActive:(UIApplication *)application
{
  if (self.mindwikiPrivacyWindow != nil) return;
  UIWindowScene *scene = nil;
  for (UIScene *candidate in application.connectedScenes) {
    if ([candidate isKindOfClass:[UIWindowScene class]] && candidate.activationState != UISceneActivationStateUnattached) {
      scene = (UIWindowScene *)candidate;
      break;
    }
  }
  if (scene == nil) return;
  UIWindow *cover = [[UIWindow alloc] initWithWindowScene:scene];
  cover.windowLevel = UIWindowLevelAlert + 1;
  cover.backgroundColor = [UIColor colorWithRed:18.0/255.0 green:22.0/255.0 blue:19.0/255.0 alpha:1.0];
  cover.rootViewController = [UIViewController new];
  cover.hidden = NO;
  self.mindwikiPrivacyWindow = cover;
}

- (void)applicationDidBecomeActive:(UIApplication *)application
{
  self.mindwikiPrivacyWindow.hidden = YES;
  self.mindwikiPrivacyWindow = nil;
}
`
  const withProperty = contents.replace(implementation, property)
  const finalEnd = withProperty.lastIndexOf(end)
  if (finalEnd < 0) throw new Error('MindWiki privacy plugin: AppDelegate end not found')
  return `${withProperty.slice(0, finalEnd)}${methods}${withProperty.slice(finalEnd)}`
}

function hardenReleaseSigning(contents) {
  const buildTypesStart = contents.indexOf('buildTypes {')
  const releaseStart = contents.indexOf('release {', buildTypesStart)
  if (buildTypesStart < 0 || releaseStart < 0) {
    throw new Error('MindWiki privacy plugin: release buildType not found')
  }
  let depth = 0
  let releaseEnd = -1
  for (let index = contents.indexOf('{', releaseStart); index < contents.length; index++) {
    if (contents[index] === '{') depth++
    if (contents[index] === '}') depth--
    if (depth === 0) {
      releaseEnd = index + 1
      break
    }
  }
  if (releaseEnd < 0) throw new Error('MindWiki privacy plugin: malformed release buildType')
  const release = contents.slice(releaseStart, releaseEnd)
  const hardened = release.replace(/^\s*signingConfig\s+signingConfigs\.debug\s*$/m, '')
  if (hardened.includes('signingConfig signingConfigs.debug')) {
    throw new Error('MindWiki privacy plugin: debug release signing remains')
  }
  return `${contents.slice(0, releaseStart)}${hardened}${contents.slice(releaseEnd)}`
}

function setNetworkInspectorDisabled(properties) {
  const without = properties.filter((item) => item.key !== 'EX_DEV_CLIENT_NETWORK_INSPECTOR')
  return [...without, { type: 'property', key: 'EX_DEV_CLIENT_NETWORK_INSPECTOR', value: 'false' }]
}

function applyAndroidBackupProtection(application) {
  application.$['android:allowBackup'] = 'false'
  application.$['android:fullBackupContent'] = 'false'
  delete application.$['android:dataExtractionRules']
  application.$['tools:replace'] = 'android:allowBackup,android:fullBackupContent'
}

function withPrivacyProtection(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
    applyAndroidBackupProtection(application)
    mod.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'
    return mod
  })
  config = withMainActivity(config, (mod) => {
    mod.modResults.contents = addAndroidFlagSecure(mod.modResults.contents, mod.modResults.language)
    return mod
  })
  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = hardenReleaseSigning(mod.modResults.contents)
    return mod
  })
  config = withGradleProperties(config, (mod) => {
    mod.modResults = setNetworkInspectorDisabled(mod.modResults)
    return mod
  })
  config = withAppDelegate(config, (mod) => {
    mod.modResults.contents = addIosPrivacyOverlay(mod.modResults.contents, mod.modResults.language)
    return mod
  })
  return config
}

module.exports = withPrivacyProtection
module.exports.addAndroidFlagSecure = addAndroidFlagSecure
module.exports.addIosPrivacyOverlay = addIosPrivacyOverlay
module.exports.hardenReleaseSigning = hardenReleaseSigning
module.exports.setNetworkInspectorDisabled = setNetworkInspectorDisabled
module.exports.applyAndroidBackupProtection = applyAndroidBackupProtection