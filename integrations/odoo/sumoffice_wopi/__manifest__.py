{
    "name": "Excel & Word Attachment Editor (SumOffice)",
    "summary": "Edit Excel and Word attachments in Odoo — xlsx, xlsm, xlsb, docx; VBA macros kept",
    "version": "18.0.1.0.1",
    "category": "Productivity/Documents",
    "license": "LGPL-3",
    "author": "SumOffice",
    "maintainer": "SumOffice",
    "website": "https://sumoffice.com",
    "support": "hello@sumoffice.com",
    "live_test_url": "https://view.sumoffice.com/view/cashflow/",
    "images": ["static/description/screenshot-workbook.png"],
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
