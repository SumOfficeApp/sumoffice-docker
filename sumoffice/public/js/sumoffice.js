// "SumOffice" next to .xlsx/.xlsm/.xlsb/.docx attachments in the form sidebar.
(function () {
    const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
    function decorate(frm) {
        const docs = frm?.get_docinfo?.()?.attachments || [];
        const wrapper = frm?.sidebar?.frm?.page?.sidebar || $(document.body);
        docs.forEach((a) => {
            const ext = (a.file_name || a.file_url || "").split(".").pop().toLowerCase();
            if (!EXTENSIONS.includes(ext)) return;
            const row = wrapper.find(`.attachment-row a[href="${a.file_url}"]`).closest(".attachment-row");
            if (!row.length || row.find(".sumoffice-open").length) return;
            $(`<a class="sumoffice-open text-muted small" style="margin-left:6px" target="_blank">SumOffice</a>`)
                .attr("href", `/sumoffice/open/${encodeURIComponent(a.name)}`)
                .attr("title", __("Open in SumOffice"))
                .appendTo(row.find(".flex, .ellipsis").first().length ? row.find(".flex, .ellipsis").first() : row);
        });
    }
    $(document).on("form-refresh", (_e, frm) => setTimeout(() => decorate(frm), 300));
    $(document).on("form-load", (_e, frm) => setTimeout(() => decorate(frm), 800));
})();
