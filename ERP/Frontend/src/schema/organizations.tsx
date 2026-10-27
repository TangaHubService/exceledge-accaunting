import * as yup from "yup";

export const createOrganizationSchema = yup.object().shape({
    name: yup
        .string()
        .required("Organization name is required")
        .min(3, "Organization name must be at least 3 characters"),
    address: yup.string().nullable(),
    phone: yup
        .string()
        .nullable()
        .matches(
            /^(\+?\d{1,3}[- ]?)?\d{9,14}$/,
            "Enter a valid phone number (e.g. +250700000000)"
        ),
    email: yup
        .string()
        .nullable()
        .email("Enter a valid email address"),
    businessType: yup
        .string()
        .required("Business type is required"),
    otherBusinessType: yup
        .string()
        .when('businessType', {
            is: 'OTHER',
            then: (s) => s.required('Please specify your business type'),
            otherwise: (s) => s.notRequired(),
        }),

});