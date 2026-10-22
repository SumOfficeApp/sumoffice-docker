/** @odoo-module **/
// Odoo 19: the chatter attachment card has no side column any more. Desktop shows
// buttons on hover (o-mail-AttachmentButtons, see attachment_list.xml); mobile shows
// a menu built from getActions(). SumOffice adds itself to both.
import { AttachmentList } from "@mail/core/common/attachment_list";
import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx", "pptx"];

patch(AttachmentList.prototype, {
    canOpenInSumOffice(attachment) {
        const ext = (attachment.extension || "").toLowerCase();
        return !attachment.uploading && !this.env.inComposer && attachment.type !== "url" && EXTENSIONS.includes(ext);
    },
    sumOfficeUrl(attachment) {
        return `/sumoffice/open/${attachment.id}`;
    },
    getActions(attachment) {
        const res = super.getActions(attachment);
        if (this.canOpenInSumOffice(attachment)) {
            res.unshift({
                label: _t("Open in SumOffice"),
                icon: "fa fa-pencil-square-o",
                onSelect: () => window.open(this.sumOfficeUrl(attachment), "_blank"),
            });
        }
        return res;
    },
});
