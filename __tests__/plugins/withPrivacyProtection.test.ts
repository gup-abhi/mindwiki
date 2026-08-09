/* eslint-disable @typescript-eslint/no-require-imports */
const {
  addAndroidFlagSecure,
  addIosPrivacyOverlay,
  hardenReleaseSigning,
  setNetworkInspectorDisabled,
  applyAndroidBackupProtection,
} = require('../../plugins/withPrivacyProtection') as {
  addAndroidFlagSecure: (contents: string, language: 'kt' | 'java') => string
  addIosPrivacyOverlay: (contents: string, language: string) => string
  hardenReleaseSigning: (contents: string) => string
  setNetworkInspectorDisabled: (properties: { type: string; key?: string; value?: string }[]) => { type: string; key?: string; value?: string }[]
  applyAndroidBackupProtection: (application: { $: Record<string, string> }) => void
}

const kotlin = `package com.example

import android.os.Bundle

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}
`

const objc = `#import "AppDelegate.h"

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

@end
`

describe('privacy config plugin transforms', () => {
  it('adds Android FLAG_SECURE before super and remains idempotent', () => {
    const once = addAndroidFlagSecure(kotlin, 'kt')
    expect(once).toContain('import android.view.WindowManager')
    expect(once.indexOf('window.setFlags')).toBeLessThan(once.indexOf('super.onCreate'))
    expect(addAndroidFlagSecure(once, 'kt')).toBe(once)
  })

  it('adds native iOS lifecycle overlay and remains idempotent', () => {
    const once = addIosPrivacyOverlay(objc, 'objcpp')
    expect(once).toContain('mindwikiPrivacyWindow')
    expect(once).toContain('initWithWindowScene')
    expect(once).toContain('applicationWillResignActive')
    expect(once).toContain('applicationDidBecomeActive')
    expect(addIosPrivacyOverlay(once, 'objcpp')).toBe(once)
  })

  it('removes generated debug signing from release builds', () => {
    const gradle = `buildTypes {\n  release {\n    signingConfig signingConfigs.debug\n    minifyEnabled true\n  }\n}`
    const hardened = hardenReleaseSigning(gradle)
    expect(hardened).not.toContain('signingConfig signingConfigs.debug')
    expect(hardened).toContain('minifyEnabled true')
    expect(hardenReleaseSigning(`buildTypes {\n  release {\n    nested { value true }\n    signingConfig signingConfigs.debug\n  }\n}`)).not.toContain('signingConfig signingConfigs.debug')
  })

  it('disables Android backup without assigning a boolean to data extraction rules', () => {
    const application = {
      $: {
        'android:dataExtractionRules': 'false',
        'tools:replace': 'android:allowBackup,android:fullBackupContent,android:dataExtractionRules',
      },
    }

    applyAndroidBackupProtection(application)

    expect(application.$).toEqual({
      'android:allowBackup': 'false',
      'android:fullBackupContent': 'false',
      'tools:replace': 'android:allowBackup,android:fullBackupContent',
    })
  })

  it('forces dev-client network inspection off', () => {
    const result = setNetworkInspectorDisabled([
      { type: 'property', key: 'EX_DEV_CLIENT_NETWORK_INSPECTOR', value: 'true' },
    ])
    expect(result).toContainEqual({
      type: 'property',
      key: 'EX_DEV_CLIENT_NETWORK_INSPECTOR',
      value: 'false',
    })
  })
})