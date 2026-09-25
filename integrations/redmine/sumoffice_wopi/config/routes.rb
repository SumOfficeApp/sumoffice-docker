get  'sumoffice/open/:id', to: 'sumoffice_wopi#open', as: 'sumoffice_open', id: /\d+/
get  'sumoffice/wopi/files/:id', to: 'sumoffice_wopi#check_file_info', id: /\d+/
post 'sumoffice/wopi/files/:id', to: 'sumoffice_wopi#file_operation', id: /\d+/
get  'sumoffice/wopi/files/:id/contents', to: 'sumoffice_wopi#get_file', id: /\d+/
post 'sumoffice/wopi/files/:id/contents', to: 'sumoffice_wopi#put_file', id: /\d+/
