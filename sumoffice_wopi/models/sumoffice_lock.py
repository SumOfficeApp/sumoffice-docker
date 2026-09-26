from odoo import fields, models


class SumofficeLock(models.Model):
    """A WOPI lock on one attachment. Only the WOPI controller touches it, as sudo."""

    _name = "sumoffice.lock"
    _description = "SumOffice WOPI lock"

    attachment_id = fields.Many2one("ir.attachment", required=True, ondelete="cascade", index=True)
    lock_id = fields.Char(required=True)
    expires_at = fields.Datetime(required=True)

    _sql_constraints = [
        ("attachment_unique", "unique(attachment_id)", "One WOPI lock per attachment."),
    ]
