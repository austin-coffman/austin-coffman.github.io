(function() {
    // https://dashboard.emailjs.com/admin/account
    emailjs.init('iEaIXYLq-zw87S_dX');
})();

window.onload = function() {
    document.getElementById('contact-form').addEventListener('submit', function(event) {
        event.preventDefault();

        document.getElementById('loading').classList.remove("disable")
        // generate a five digit number for the contact_number variable
        this.contact_number.value = Math.random() * 100000 | 0;
        // these IDs from the previous steps
        emailjs.sendForm('service_0ea162i', 'template_loajh2a', this)

            .then(function() {
                console.log('SUCCESS!');
                document.getElementById('loading').classList.add("disable")
                document.getElementById('sent-message').classList.remove("disable")
            }, function(error) {
                console.log('FAILED...', error);
                document.getElementById('loading').classList.add("disable")
                document.getElementById('error-message').classList.remove("disable")
            });
    });
}