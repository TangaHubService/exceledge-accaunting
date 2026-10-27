
import * as yup from "yup";
export const LoginSchema = yup.object().shape({
    email: yup
        .string()
        .email("Please enter a valid email address")
        .required("Email is required"),
    password: yup
        .string()
        .required("Password is required"),
});

// Validation schema
yup.setLocale({
    mixed: {
        required: 'This field is required',
    },
    string: {
        email: 'Please enter a valid email address',
        min: '${path} must be at least ${min} characters',
    },
});

export const signUpSchema = yup.object().shape({
    name: yup.string().required().label('Full Name'),
    lastName: yup.string().required().label('Last Name'),
    email: yup.string().email().required().label('Email'),
    phone: yup
        .string()
        .test('is-valid-phone', 'Please enter a valid phone number', (value) => {
            if (!value) return false;
            const digitsOnly = value.replace(/\D/g, '');
            return digitsOnly.length >= 10;
        })
        .required('Phone number is required'),
    password: yup.string().min(6).required().label('Password'),
    confirmPassword: yup
        .string()
        .oneOf([yup.ref('password')], 'Passwords must match')
        .required('Please confirm your password'),
});