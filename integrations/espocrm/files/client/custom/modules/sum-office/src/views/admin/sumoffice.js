// Administration → SumOffice: the editor address, proof verification, and a connection check.
define('sum-office:views/admin/sumoffice', ['views/settings/record/edit'], function (Dep) {

    return Dep.extend({

        layoutName: 'sumOffice',

        setup: function () {
            Dep.prototype.setup.call(this);
            // Not written yet means on: the server verifies proofs unless this is explicitly false.
            if (this.model.get('sumofficeVerifyProof') === undefined || this.model.get('sumofficeVerifyProof') === null) {
                this.model.set('sumofficeVerifyProof', true, {silent: true});
            }
            this.addButton({
                name: 'checkConnection',
                label: 'Check connection',
                style: 'default',
            });
        },

        actionCheckConnection: function () {
            Espo.Ui.notify(' ... ');
            Espo.Ajax.getRequest('SumOffice/check').then(result => {
                Espo.Ui.notify(false);
                const text = result.message || (result.ok ? 'Connected.' : 'Not connected.');
                Espo.Ui.notify(text, result.ok ? 'success' : 'danger', 15000, {closeButton: true});
            });
        },
    });
});
