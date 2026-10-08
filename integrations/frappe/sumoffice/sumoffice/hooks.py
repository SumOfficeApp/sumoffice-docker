app_name = "sumoffice"
app_title = "SumOffice"
app_publisher = "SumOffice"
app_description = "Open and edit .xlsx, .xlsm, .xlsb, .docx and .pptx attachments in SumOffice (SumSheet, SumDoc, SumSlide) over WOPI"
app_email = "hello@sumoffice.com"
app_license = "mit"
# Карточка маркетплейса: логотип и ссылки, которые Frappe Cloud берёт из приложения.
app_logo_url = "/assets/sumoffice/images/sumoffice-icon.png"
app_color = "#1f7a4d"
app_home = "https://sumoffice.com"

# /sumoffice/open/<file> and the WOPI endpoints /wopi/files/<file>[/contents]
page_renderer = ["sumoffice.wopi.WopiRenderer"]

# The editor sends its access token in the query AND as `Authorization: Bearer`; Frappe would read
# the header as an OAuth token of its own and refuse the call with 401 before the renderer runs.
before_request = ["sumoffice.wopi.ignore_bearer_on_wopi_routes"]

# "SumOffice" link next to office attachments in the form sidebar
app_include_js = "/assets/sumoffice/js/sumoffice.js"
