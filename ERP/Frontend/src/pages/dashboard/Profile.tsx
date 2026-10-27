import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";

import PhoneInputWithCountryCode from "../../components/PhoneInputWithCountryCode";
import { toast } from "react-toastify";
import { apiClient } from "../../lib/api-client";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Loader2, Pencil, Save, X, Upload } from "lucide-react";

type Organization = {
    id: number;
    name: string;
    address: string;
    phone: string;
    email: string;
    businessType: string;
    role: string;
    isOwner: boolean;
};

type UserProfile = {
    id: number;
    email: string;
    name: string;
    role: string;
    phone: string;
    isActive: boolean;
    organizations: Organization[];
    profileImage?: string;
};

export function Profile() {
    const { t } = useTranslation();
    const [isEditing, setIsEditing] = useState(false);

    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [imagePreview, setImagePreview] = useState<string>("");

    const { register, handleSubmit, reset, formState: { errors }, setValue, watch } = useForm<UserProfile>();

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            setIsLoading(true);
            const response = await apiClient.profile();
            setProfile(response);
            reset(response);
            if (response.profileImage) setImagePreview(response.profileImage);
        } catch (error) {
            console.error("Failed to fetch profile:", error);
            toast.error(t('messages.errorLoadingData'));
        } finally {

            setIsLoading(false);
        }
    };

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            // Create preview
            const imageUrl = URL.createObjectURL(file);
            setPreviewImage(imageUrl);

            try {
                setIsUploading(true);
                const formData = new FormData();
                formData.append("profileImage", file);
                await apiClient.updateProfileImage(formData, profile?.id!);
                await fetchProfile();
                toast.success(t('messages.profileImageSuccess'));
            } catch (error) {
                console.error("Failed to update profile image:", error);
                toast.error(t('messages.profileImageError'));
                setPreviewImage(null);
            } finally {

                setIsUploading(false);
            }
        }
    };

    // Clean up preview URL on unmount
    useEffect(() => {
        return () => {
            if (previewImage) {
                URL.revokeObjectURL(previewImage);
            }
        };
    }, [previewImage]);

    const onSubmit = async (data: UserProfile) => {
        try {
            setIsSaving(true);
            await apiClient.updateProfile(data, profile?.id!);
            await fetchProfile();
            toast.success(t('messages.profileUpdateSuccess'));
        } catch (error) {
            console.error("Failed to update profile:", error);
            toast.error(t('messages.profileUpdateError'));
        } finally {

            setIsSaving(false);
        }
    };

    const getInitials = (name: string) =>
        name.split(" ").map((n) => n[0]).join("").toUpperCase();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!profile) return <div>{t('messages.errorLoadingData')}</div>;


    return (
        <div className="container mx-auto max-w-6xl p-6 space-y-10 dark:bg-gray-900 dark:text-white">
            {/* HEADER */}
            <div className="bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-500 text-white p-8 rounded-2xl shadow-md">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-lg">
                            {imagePreview ? (
                                <img src={imagePreview} alt={profile.name} className="object-cover w-full h-full" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-indigo-600 text-3xl font-bold">
                                    {getInitials(profile.name)}
                                </div>
                            )}
                        </div>
                        <div>
                            <h1 className="text-2xl font-semibold">{profile.name}</h1>
                            <p className="opacity-90">{profile.email}</p>
                            <span className="inline-block mt-2 px-3 py-1 text-xs font-medium rounded-full bg-white/20">
                                {profile.role}
                            </span>
                        </div>
                    </div>

                    {!isEditing ? (
                        <Button
                            className="bg-white text-blue-700 hover:bg-blue-50"
                            onClick={() => setIsEditing(true)}
                        >
                            <Pencil className="h-4 w-4 mr-2" />
                            {t('common.edit')} {t('common.profile')}
                        </Button>

                    ) : (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setIsEditing(false);
                                    reset();
                                    setPreviewImage(null);
                                    if (profile.profileImage) setImagePreview(profile.profileImage);
                                }}
                                className="bg-white/10 text-white border-white/30 hover:bg-white/20"
                            >
                                <X className="h-4 w-4 mr-2" />
                                {t('common.cancel')}
                            </Button>

                            <Button
                                onClick={handleSubmit(onSubmit)}
                                disabled={isSaving}
                                className="bg-white text-blue-700 hover:bg-blue-50"
                            >
                                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                {t('common.save')}
                            </Button>

                        </div>
                    )}
                </div>
            </div>

            {/* BODY */}
            <div className="dark:bg-gray-900 dark:text-white">
                {/* LEFT */}
                <div className="space-y-6 flex flex-col md:flex-row md:col-span-2 gap-4 py-8">
                    <Card className="rounded-2xl border border-gray-200 shadow-sm w-full md:w-1/2">
                        <CardHeader>
                            <CardTitle className="text-lg font-semibold">{t('common.profilePicture')}</CardTitle>
                        </CardHeader>

                        <CardContent className="flex flex-col items-center space-y-4">
                            <div className="relative">
                                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-indigo-100 bg-gray-50 flex items-center justify-center">
                                    {previewImage ? (
                                        <img src={previewImage} alt={profile.name} className="object-cover w-full h-full" />
                                    ) : profile.profileImage ? (
                                        <img src={profile.profileImage} alt={profile.name} className="object-cover w-full h-full" />
                                    ) : (
                                        <span className="text-2xl font-bold text-gray-500">{getInitials(profile.name)}</span>
                                    )}
                                </div>
                                {isEditing && (
                                    <label className="absolute bottom-1 right-1 bg-indigo-600 text-white p-2 rounded-full shadow cursor-pointer hover:bg-indigo-700 transition">
                                        {isUploading ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Upload className="h-4 w-4" />
                                        )}
                                        <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                                    </label>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="rounded-2xl border border-gray-200 shadow-sm w-full md:w-1/2 dark:bg-gray-800 dark:border-gray-700">
                        <CardHeader>
                            <CardTitle className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">{t('common.organization')}</CardTitle>
                        </CardHeader>

                        <CardContent>
                            {profile.organizations.length > 0 ? (
                                <div className="space-y-4 dark:text-white">
                                    {profile.organizations.map((org) => (
                                        <div key={org.id} className="border border-gray-100 rounded-lg p-3 bg-indigo-50/40 dark:bg-gray-700/40 dark:border-gray-600">
                                            <h3 className="font-medium text-sm text-indigo-700 dark:text-indigo-300">{org.name}</h3>
                                            <p className="text-xs text-gray-600 dark:text-gray-400">{org.businessType}</p>
                                            <p className="text-xs mt-1 text-gray-700 dark:text-gray-300">{org.address}</p>
                                            <p className="text-xs text-gray-700 dark:text-gray-300">{org.phone}</p>
                                            <p className="text-xs text-gray-700 dark:text-gray-300">{org.email}</p>
                                            <span className="inline-block mt-2 text-xs px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded dark:bg-indigo-900/30 dark:text-indigo-300">
                                                {org.role} {org.isOwner && `(${t('common.owner')})`}
                                            </span>
                                        </div>

                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500 text-sm">{t('messages.noOrganizationFound')}</p>
                            )}
                        </CardContent>

                    </Card>
                </div>

                {/* RIGHT */}
                <div className="col-span-2">
                    <Card className="rounded-2xl border border-gray-200 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                        <CardHeader>
                            <CardTitle className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">{t('common.profileInfo')}</CardTitle>
                        </CardHeader>

                        <CardContent>
                            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <Label htmlFor="name">{t('customers.fullName')}</Label>
                                        <Input
                                            id="name"
                                            {...register("name", { required: t('validation.required') })}
                                            disabled={!isEditing || isSaving}

                                            className="mt-1 focus:ring-indigo-500"
                                        />
                                        {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>}
                                    </div>

                                    <div>
                                        <Label htmlFor="email">{t('common.email')}</Label>

                                        <Input
                                            id="email"
                                            type="email"
                                            value={profile.email}
                                            disabled
                                            className="mt-1 bg-gray-100 dark:bg-gray-800"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            {t('messages.contactSupportEmail')}
                                        </p>
                                    </div>


                                    <div>
                                        <Label htmlFor="phone">{t('common.phone')}</Label>

                                        <PhoneInputWithCountryCode
                                            value={watch('phone') ?? ''}
                                            onChange={(value: string) => setValue('phone', value, { shouldValidate: true })}
                                            placeholder="e.g. 700 000 000"
                                            disabled={!isEditing || isSaving}
                                            error={errors.phone ? String(errors.phone.message) : ''}
                                            className="mt-1"
                                        />
                                        {errors.phone && <p className="text-sm text-red-500 mt-1">{errors.phone.message}</p>}
                                    </div>

                                    <div>
                                        <Label>{t('common.accountStatus')}</Label>
                                        <div className="mt-1">
                                            <span

                                                className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-medium ${profile.isActive
                                                    ? "bg-green-100 text-green-800"
                                                    : "bg-red-100 text-red-800"
                                                    }`}
                                            >
                                                {profile.isActive ? t('common.active') : t('common.inactive')}
                                            </span>
                                        </div>
                                    </div>

                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
