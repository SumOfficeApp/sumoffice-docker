// Administration → Integrations → SumOffice: the standard integration form plus a connection check.
define('sum-office:views/admin/integration', ['views/admin/integrations/edit'], function (Dep) {

    return Dep.extend({

        setup: function () {
            Dep.prototype.setup.call(this);
            this.addActionHandler('sumofficeCheck', () => this.checkConnection());
            // A record saved before proof verification existed reads as empty: on unless explicitly off.
            this.listenToOnce(this.model, 'sync', () => {
                if (this.model.get('sumofficeVerifyProof') === undefined || this.model.get('sumofficeVerifyProof') === null) {
                    this.model.set('sumofficeVerifyProof', true);
                }
                if (!this.model.get('sumofficeEditorWindow')) {
                    this.model.set('sumofficeEditorWindow', 'auto');
                }
            });
        },

        afterRender: function () {
            Dep.prototype.afterRender.call(this);
            const group = this.element.querySelector('.button-container .btn-group');
            if (group && !group.querySelector('[data-action="sumofficeCheck"]')) {
                const button = document.createElement('button');
                button.className = 'btn btn-default btn-xs-wide';
                button.dataset.action = 'sumofficeCheck';
                button.textContent = 'Check connection';
                group.appendChild(button);
            }
        },

        checkConnection: function () {
            Espo.Ui.notify(' ... ');
            Espo.Ajax.getRequest('SumOffice/check').then(result => {
                Espo.Ui.notify(false);
                const text = result.message || (result.ok ? 'Connected.' : 'Not connected.');
                Espo.Ui.notify(text, result.ok ? 'success' : 'danger', 15000, {closeButton: true});
            });
        },
    });
});
