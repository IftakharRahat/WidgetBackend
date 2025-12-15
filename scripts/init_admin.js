
const registerAdmin = async () => {
    try {
        const response = await fetch('http://localhost:3000/api/v1/admin/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: 'admin@local.com',
                password: 'password123',
                name: 'Admin User'
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log('SUCCESS: Admin registered successfully');
            console.log('Email: admin@local.com');
            console.log('Password: password123');
            console.log('Token:', data.token);
        } else {
            console.log('FAILED:', data.error);
        }
    } catch (error) {
        console.error('ERROR:', error.message);
    }
};

registerAdmin();
