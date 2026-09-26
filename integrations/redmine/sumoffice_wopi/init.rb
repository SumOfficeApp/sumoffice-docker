require_relative 'lib/sumoffice_wopi'
require_relative 'lib/sumoffice_wopi/hooks'

Redmine::Plugin.register :sumoffice_wopi do
  name 'SumOffice'
  author 'SumOffice'
  description 'Open .xlsx, .xlsm, .xlsb and .docx attachments in SumOffice (SumSheet, SumDoc) over WOPI. Ctrl+S saves the file back into the same attachment.'
  version '1.0.0'
  url 'https://sumoffice.com'
  author_url 'https://sumoffice.com'
  requires_redmine version_or_higher: '5.0.0'
  settings default: { 'discovery_url' => '', 'verify_proof' => '1' }, partial: 'settings/sumoffice_wopi'
end
