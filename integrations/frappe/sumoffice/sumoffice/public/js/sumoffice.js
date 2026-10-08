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
            if (!row.length || row.next(".sumoffice-row").length) return;
            // Its own line under the file: inside the row the link sat in the ellipsis box of the
            // file name and Frappe 15 clipped it out of sight together with the name's tail.
            const link = $(`<a class="sumoffice-open small" target="_blank"></a>`)
                .text(__("Open in SumOffice"))
                .attr("href", `/sumoffice/open/${encodeURIComponent(a.name)}`)
                .attr("title", a.file_name || "");
            $(`<div class="sumoffice-row" style="padding:2px 0 6px 22px"></div>`).append(link).insertAfter(row);
        });
    }
    $(document).on("form-refresh", (_e, frm) => setTimeout(() => decorate(frm), 300));
    $(document).on("form-load", (_e, frm) => setTimeout(() => decorate(frm), 800));
})();
