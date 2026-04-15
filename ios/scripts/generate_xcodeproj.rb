#!/usr/bin/env ruby
require 'fileutils'
require 'xcodeproj'

ios_root = File.expand_path('..', __dir__)
project_path = File.join(ios_root, 'ContextRestoreiOS.xcodeproj')

FileUtils.rm_rf(project_path)
project = Xcodeproj::Project.new(
  project_path,
  false,
  Xcodeproj::Constants::LAST_KNOWN_OBJECT_VERSION
)

project.root_object.attributes['LastSwiftUpdateCheck'] = '2630'
project.root_object.attributes['LastUpgradeCheck'] = '2630'

app_target = project.new_target(:application, 'ContextRestoreiOS', :ios, '17.0')
app_target.product_name = 'ContextRestoreiOS'

main_group = project.main_group
app_group = main_group.find_subpath('ContextRestoreiOSApp', true)
app_group.set_source_tree('<group>')
app_group.path = 'ContextRestoreiOSApp'
app_entry_ref = app_group.new_file('ContextRestoreiOSApp.swift')
app_target.source_build_phase.add_file_reference(app_entry_ref)

local_package = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
local_package.relative_path = 'app'
project.root_object.package_references << local_package

package_dependency = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
package_dependency.product_name = 'ContextRestoreIOSKit'
package_dependency.package = local_package
app_target.package_product_dependencies << package_dependency

target_dependency = project.new(Xcodeproj::Project::Object::PBXTargetDependency)
target_dependency.product_ref = package_dependency
app_target.dependencies << target_dependency

package_build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
package_build_file.product_ref = package_dependency
app_target.frameworks_build_phase.files << package_build_file

bundle_identifier = 'com.avitalmintz.ContextRestoreiOS'

app_target.build_configurations.each do |config|
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
  config.build_settings['DEVELOPMENT_TEAM'] = ''
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_identifier
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents'] = 'YES'
  config.build_settings['INFOPLIST_KEY_UIRequiresFullScreen'] = 'YES'
  config.build_settings['INFOPLIST_KEY_UILaunchScreen_Generation'] = 'YES'
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  config.build_settings['SUPPORTED_PLATFORMS'] = 'iphoneos iphonesimulator'
  config.build_settings['SUPPORTS_MACCATALYST'] = 'NO'
  config.build_settings['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks']
  if config.name == 'Debug'
    config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone'
  end
end

project.build_configurations.each do |config|
  config.build_settings['SWIFT_VERSION'] = '5.0'
end

project.recreate_user_schemes
project.save

puts "Generated: #{project_path}"
