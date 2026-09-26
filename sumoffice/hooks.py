app_name = "sumoffice"
app_title = "SumOffice"
app_publisher = "SumOffice"
app_description = "Open and edit .xlsx, .xlsm, .xlsb and .docx attachments in SumOffice (SumSheet, SumDoc) over WOPI"
app_email = "hello@sumoffice.com"
app_license = "mit"

# /sumoffice/open/<file> and the WOPI endpoints /wopi/files/<file>[/contents]
page_renderer = ["sumoffice.wopi.WopiRenderer"]

# "SumOffice" link next to office attachments in the form sidebar
app_include_js = "/assets/sumoffice/js/sumoffice.js"
