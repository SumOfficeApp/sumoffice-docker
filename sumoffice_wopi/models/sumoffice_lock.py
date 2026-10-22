from odoo import fields, models


class SumofficeLock(models.Model):
    """A WOPI lock on one attachment. Only the WOPI controller touches it, as sudo."""

    _name = "sumoffice.lock"
    _description = "SumOffice WOPI lock"

    attachment_id = fields.Many2one("ir.attachment", required=True, ondelete="cascade", index=True)
    lock_id = fields.Char(required=True)
    expires_at = fields.Datetime(required=True)

    # Odoo 19 dropped _sql_constraints: a list there is ignored with a warning.
    _attachment_unique = models.Constraint("unique(attachment_id)", "One WOPI lock per attachment.")
