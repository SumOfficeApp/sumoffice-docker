// "Open in SumOffice" next to an Excel or Word file of a Document.
define('sum-office:views/fields/sumoffice-file', ['views/fields/file'], function (Dep) {
    const EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'docx'];

    return Dep.extend({
        afterRender: function () {
            Dep.prototype.afterRender.call(this);
            const id = this.model.get(this.idName);
            const name = this.model.get(this.nameName) || '';
            const ext = name.split('.').pop().toLowerCase();
            if (!id || !EXTENSIONS.includes(ext) || this.isEditMode()) {
                return;
            }
            const link = document.createElement('a');
            link.className = 'sumoffice-open btn btn-default btn-sm';
            link.style.marginLeft = '8px';
            link.target = '_blank';
            link.href = '?entryPoint=sumOfficeOpen&id=' + encodeURIComponent(id);
            link.textContent = 'Open in SumOffice';
            this.element.appendChild(link);
        },
    });
});
