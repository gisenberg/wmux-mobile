Pod::Spec.new do |s|
  s.name = 'WmuxKeyInput'
  s.version = '0.1.0'
  s.summary = 'Native terminal keyboard and IME input for wmux mobile'
  s.description = 'A non-WebView terminal input surface with semantic hardware keys and committed IME text.'
  s.author = 'wmux'
  s.homepage = 'https://github.com/gisenberg/wmux'
  s.platforms = {
    :ios => '16.4'
  }
  s.source = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
