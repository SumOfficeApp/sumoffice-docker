require_relative 'lib/sumoffice_wopi'
require_relative 'lib/sumoffice_wopi/hooks'

Redmine::Plugin.register :sumoffice_wopi do
  name 'Edit Office Files Online (Word, Excel with macros) — SumOffice'
  author 'SumOffice'
  description 'Open and edit Word and Excel attachments of issues, documents and files right in Redmine, in the browser; Ctrl+S saves back into the same attachment. Macros in xlsm are kept.'
  version '1.0.1'
  url 'https://sumoffice.com/redmine.html'
  author_url 'https://sumoffice.com'
  requires_redmine version_or_higher: '5.0.0'
  settings default: { 'discovery_url' => '', 'verify_proof' => '1' }, partial: 'settings/sumoffice_wopi'
end
