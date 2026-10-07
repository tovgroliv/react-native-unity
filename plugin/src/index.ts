import {
  AndroidConfig,
  WarningAggregator,
  withAndroidManifest,
  withProjectBuildGradle,
  withSettingsGradle,
  withStringsXml,
} from '@expo/config-plugins';
import type { ConfigPlugin } from '@expo/config-plugins';
import fs from 'fs';
import path from 'path';

type UnityPluginProps = {
  /**
   * Folder with the Unity Android export (the one that contains `unityLibrary`),
   * relative to the project root. Defaults to `unity/builds/android`.
   */
  androidExportPath?: string;
};

const PLUGIN_NAME = 'react-native-unity';
const DEFAULT_ANDROID_EXPORT_PATH = 'unity/builds/android';

// Attributes Unity puts on <application> in unityLibrary's manifest that the app
// usually sets too. The app value must win, otherwise the manifest merge fails.
const UNITY_APPLICATION_ATTRIBUTES = ['android:enableOnBackInvokedCallback'];

const withUnity: ConfigPlugin<UnityPluginProps | void> = (config, props) => {
  const androidExportPath =
    (props && props.androidExportPath) || DEFAULT_ANDROID_EXPORT_PATH;
  config = withSettingsGradleMod(config, androidExportPath);
  config = withProjectBuildGradleMod(config);
  config = withAndroidManifestMod(config, androidExportPath);
  config = withStringsXMLMod(config);
  return config;
};

const GENERATED_BEGIN = `// @generated begin ${PLUGIN_NAME} - expo prebuild (DO NOT MODIFY)`;
const GENERATED_END = `// @generated end ${PLUGIN_NAME}`;

// Appends the block to the end of a gradle file, replacing the one added by a previous prebuild.
const setGeneratedBlock = (contents: string, block: string) => {
  const start = contents.indexOf(GENERATED_BEGIN);
  const end = contents.indexOf(GENERATED_END);
  if (start !== -1 && end > start) {
    contents =
      contents.slice(0, start) + contents.slice(end + GENERATED_END.length);
  }
  return `${contents.trimEnd()}\n\n${GENERATED_BEGIN}\n${block}\n${GENERATED_END}\n`;
};

const toGroovyString = (value: string) =>
  `'${value.replace(/\\/g, '/').replace(/'/g, "\\'")}'`;

const withSettingsGradleMod: ConfigPlugin<string> = (
  config,
  androidExportPath
) =>
  withSettingsGradle(config, (modConfig) => {
    const { projectRoot, platformProjectRoot } = modConfig.modRequest;
    const exportDir = path.relative(
      platformProjectRoot,
      path.resolve(projectRoot, androidExportPath)
    );
    const exportDirFile = path.isAbsolute(exportDir)
      ? `new File(${toGroovyString(exportDir)})`
      : `new File(rootDir, ${toGroovyString(exportDir)})`;

    modConfig.modResults.contents = setGeneratedBlock(
      modConfig.modResults.contents,
      `def unityExportDir = ${exportDirFile}
include ':unityLibrary'
project(':unityLibrary').projectDir = new File(unityExportDir, 'unityLibrary')

// Unity's exported gradle scripts read unityStreamingAssets and unity.* (androidSdkPath,
// androidNdkPath, ...) from the export's gradle.properties, so pass them to every project.
// Values from the app's gradle.properties take precedence.
def unityProperties = new Properties()
def unityPropertiesFile = new File(unityExportDir, 'gradle.properties')
if (unityPropertiesFile.exists()) {
  unityPropertiesFile.withInputStream { unityProperties.load(it) }
}
unityProperties.putIfAbsent('unityStreamingAssets', '.unity3d')
gradle.beforeProject { p ->
  unityProperties.each { key, value ->
    if ((key == 'unityStreamingAssets' || key.startsWith('unity.')) && !p.hasProperty(key)) {
      p.ext.set(key, value)
    }
  }
}`
    );
    return modConfig;
  });

const withProjectBuildGradleMod: ConfigPlugin = (config) =>
  withProjectBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = setGeneratedBlock(
      modConfig.modResults.contents,
      `allprojects {
  repositories {
    flatDir {
      dirs "\${project(':unityLibrary').projectDir}/libs"
    }
  }
}`
    );
    return modConfig;
  });

const isLauncherIntentFilter = (
  filter: AndroidConfig.Manifest.ManifestIntentFilter
) =>
  !!filter.action?.some(
    (action) => action.$['android:name'] === 'android.intent.action.MAIN'
  ) &&
  !!filter.category?.some(
    (category) =>
      category.$['android:name'] === 'android.intent.category.LAUNCHER'
  );

const getUnityLauncherActivities = async (unityManifestPath: string) => {
  const unityManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
    unityManifestPath
  );
  // Unity's <application> has no android:name, so getMainApplication() can't find it
  const unityApplication = unityManifest.manifest.application?.[0];
  return (unityApplication?.activity ?? [])
    .filter((activity) =>
      (activity['intent-filter'] ?? []).some(isLauncherIntentFilter)
    )
    .map((activity) => activity.$['android:name']);
};

const withAndroidManifestMod: ConfigPlugin<string> = (
  config,
  androidExportPath
) =>
  withAndroidManifest(config, async (modConfig) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(
      modConfig.modResults
    );
    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    const conflictingAttributes = UNITY_APPLICATION_ATTRIBUTES.filter(
      (attribute) => application.$[attribute] !== undefined
    );
    if (conflictingAttributes.length > 0) {
      const replace = new Set(
        (application.$['tools:replace'] ?? '')
          .split(',')
          .map((attribute) => attribute.trim())
          .filter(Boolean)
      );
      conflictingAttributes.forEach((attribute) => replace.add(attribute));
      application.$['tools:replace'] = [...replace].join(',');
    }

    // Unity's activity must not become a second launcher icon: drop its intent filters
    // through the manifest merger instead of editing the Unity export by hand.
    const unityManifestPath = path.resolve(
      modConfig.modRequest.projectRoot,
      androidExportPath,
      'unityLibrary/src/main/AndroidManifest.xml'
    );
    if (!fs.existsSync(unityManifestPath)) {
      WarningAggregator.addWarningAndroid(
        PLUGIN_NAME,
        `Unity Android export not found at ${unityManifestPath}. Export the Unity project and run prebuild again.`
      );
      return modConfig;
    }
    const activities = (application.activity = application.activity ?? []);
    for (const name of await getUnityLauncherActivities(unityManifestPath)) {
      if (activities.some((activity) => activity.$['android:name'] === name)) {
        continue;
      }
      const removeIntentFilters: Record<string, string> = {
        'tools:node': 'removeAll',
      };
      activities.push({
        '$': { 'android:name': name },
        'intent-filter': [{ $: removeIntentFilters }],
      });
    }
    return modConfig;
  });

// add string
const withStringsXMLMod: ConfigPlugin = (config) =>
  withStringsXml(config, (modConfig) => {
    modConfig.modResults = AndroidConfig.Strings.setStringItem(
      [
        {
          _: 'Game View',
          $: {
            name: 'game_view_content_description',
          },
        },
      ],
      modConfig.modResults
    );
    return modConfig;
  });

export default withUnity;
