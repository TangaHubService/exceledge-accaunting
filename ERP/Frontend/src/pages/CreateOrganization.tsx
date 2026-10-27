import React from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Building2, Loader2 } from "lucide-react";
import PhoneInputWithCountryCode from "../components/PhoneInputWithCountryCode";
import { apiClient } from "../lib/api-client";
import { createOrganizationSchema } from "../schema/organizations";
import { useAuth } from "../context/AuthContext";
import { useOrganization } from "../context/OrganizationContext";

export default function CreateOrganizationPage() {
  const navigate = useNavigate();
  const { setOrganization } = useOrganization();
  const { refreshUserProfile } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    reset,
  } = useForm({
    resolver: yupResolver(createOrganizationSchema),
  });

  const [toast, setToast] = React.useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);

  const showToast = (message: string, type: "error" | "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const onSubmit = async (data: any) => {
    try {
      const response = await apiClient.createOrganization(data);
      localStorage.setItem(
        "organization",
        JSON.stringify(response.organization)
      );
      localStorage.setItem("current_organization_id", String(response.organization.id));

      // Update organization context
      setOrganization({
        id: response.organization.id,
        name: response.organization.name,
        businessType: response.organization.businessType,
        address: response.organization.address,
        phone: response.organization.phone,
        email: response.organization.email,
      });

      // Refresh user profile to get updated role
      await refreshUserProfile();

      showToast("Your organization has been created successfully", "success");
      reset();
      setTimeout(() => {
        navigate("/dashboard");
      }, 1500);
    } catch (error: any) {
      showToast(
        error instanceof Error ? error.message : error.message,
        "error"
      );
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat transition-all duration-500 py-12 px-4"
      style={{ backgroundImage: "url('/auth-bg.png')" }}
    >
      <div className="absolute inset-0 bg-blue-900/10 backdrop-blur-[2px]"></div>

      <div className="relative w-full max-w-xl">
        {/* Toast */}
        {toast && (
          <div
            className={`mb-4 p-4 border rounded-lg ${toast.type === "error"
              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-400"
              : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-400"
              }`}
          >
            <p className="text-sm">{toast.message}</p>
          </div>
        )}

        {/* Create Organization Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-6 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Create Your Organization
              </h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Set up your organization to get started
            </p>
          </div>

          <div className="p-6 pt-0">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Organization Name */}
              <div className="space-y-2">
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Organization Name *
                </label>
                <input
                  id="name"
                  type="text"
                  placeholder="e.g., AgaciroPlus"
                  {...register("name")}
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ${errors.name
                    ? "border-red-500 focus:ring-red-400"
                    : "border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                    }`}
                />
                {errors.name && (
                  <p className="text-sm text-red-500">{errors.name.message}</p>
                )}
              </div>
              {/* businessType */}
              <div className="space-y-2">
                <label
                  htmlFor="businessType"
                  className="block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Business Type *
                </label>
                <select
                  id="businessType"
                  {...register("businessType")}
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ${errors.businessType
                    ? "border-red-500 focus:ring-red-400"
                    : "border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                    }`}
                >
                  <option value="">Select Business Type</option>
                  <option value="PHARMACY">Pharmacy</option>
                  <option value="HARDWARE_STORE">Hardware Store</option>
                  <option value="RETAIL_SHOP">Retail Shop</option>
                  <option value="GROCERY_STORE">Grocery Store</option>
                  <option value="ELECTRONICS_STORE">Electronics Store</option>
                  <option value="CLOTHING_STORE">Clothing Store</option>
                  <option value="RESTAURANT">Restaurant</option>
                  <option value="BAKERY">Bakery</option>
                  <option value="OTHER">Other</option>
                </select>
                {errors.businessType && (
                  <p className="text-sm text-red-500">
                    {errors.businessType.message}
                  </p>
                )}
                {watch('businessType') === 'OTHER' && (
                  <div className="mt-3 space-y-2">
                    <label
                      htmlFor="otherBusinessType"
                      className="block text-sm font-medium text-gray-900 dark:text-white"
                    >
                      Specify Business Type *
                    </label>
                    <input
                      id="otherBusinessType"
                      type="text"
                      placeholder="e.g., Car Wash"
                      {...register("otherBusinessType")}
                      className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ${errors.otherBusinessType
                        ? "border-red-500 focus:ring-red-400"
                        : "border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                        }`}
                    />
                    {errors.otherBusinessType && (
                      <p className="text-sm text-red-500">{errors.otherBusinessType.message}</p>
                    )}
                  </div>
                )}
              </div>
              {/* Address */}
              <div className="space-y-2">
                <label
                  htmlFor="address"
                  className="block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Address
                </label>
                <input
                  id="address"
                  type="text"
                  placeholder="KG 123 St, Kigali"
                  {...register("address")}
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ${errors.address
                    ? "border-red-500 focus:ring-red-400"
                    : "border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                    }`}
                />
                {errors.address && (
                  <p className="text-sm text-red-500">
                    {errors.address.message}
                  </p>
                )}
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <label
                  htmlFor="phone"
                  className="block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Phone Number
                </label>
                <PhoneInputWithCountryCode
                  value={watch('phone') ?? ''}
                  onChange={(value: string) => setValue('phone', value, { shouldValidate: true })}
                  placeholder="e.g. 700 000 000"
                  disabled={isSubmitting}
                  error={errors.phone ? String(errors.phone.message) : ''}
                  className="w-full"
                />
                {errors.phone && (
                  <p className="text-sm text-red-500">{errors.phone.message}</p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="Enter organization email"
                  {...register("email")}
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ${errors.email
                    ? "border-red-500 focus:ring-red-400"
                    : "border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                    }`}
                />
                {errors.email && (
                  <p className="text-sm text-red-500">{errors.email.message}</p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Create Organization"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
