Pod::Spec.new do |s|
  s.name           = 'AppleMusic'
  s.version        = '0.1.0'
  s.summary        = 'Full-track Apple Music playback for VYBZ via MusicKit'
  s.description    = 'Lets Apple Music subscribers hear full tracks in VYBZ battles.'
  s.license        = 'UNLICENSED'
  s.author         = 'VYBZ'
  s.homepage       = 'https://urexp.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MusicKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
