from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    sumoffice_discovery_url = fields.Char(
        string="SumOffice discovery URL",
        config_parameter="sumoffice.discovery_url",
        help="WOPI discovery of the SumOffice stack, e.g. https://office.example.com/hosting/discovery",
    )
    sumoffice_verify_proof = fields.Boolean(
        string="Verify WOPI proof keys",
        config_parameter="sumoffice.verify_proof",
        default=True,
    )
    sumoffice_ca_bundle = fields.Char(
        string="CA bundle for discovery",
        config_parameter="sumoffice.ca_bundle",
        help="Path to a CA file when SumOffice uses a private certificate. Empty = system trust.",
    )
