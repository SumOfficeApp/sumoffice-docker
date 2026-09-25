{
    "name": "SumOffice for Odoo",
    "summary": "Open and edit xlsx, xlsm, xlsb and docx attachments in SumOffice (SumSheet, SumDoc) over WOPI",
    "version": "18.0.1.0.0",
    "category": "Productivity/Documents",
    "license": "LGPL-3",
    "author": "SumOffice",
    "website": "https://github.com/SumOfficeApp/sumoffice-docker",
    "depends": ["mail"],
    "data": [
        "security/ir.model.access.csv",
        "views/res_config_settings_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "sumoffice_wopi/static/src/attachment_list.xml",
        ],
    },
    "installable": True,
    "application": False,
}
