import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Globe } from 'lucide-react';

interface Language {
    code: string;
    name: string;
    nativeName: string;
}

const languages: Language[] = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'rw', name: 'Kinyarwanda', nativeName: 'Ikinyarwanda' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
];

export const LanguageSwitcher: React.FC<{ toolbar?: boolean }> = ({ toolbar = false }) => {
    const { i18n, t } = useTranslation();


    const currentLanguage = languages.find((lang) => lang.code === i18n.language) || languages[0];

    const changeLanguage = (languageCode: string) => {
        i18n.changeLanguage(languageCode);
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        toolbar
                            ? 'border-white/25 bg-white/10 text-white hover:bg-white/15'
                            : 'border-gray-200 bg-white text-gray-700 shadow-sm hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                    }`}
                    aria-label={t('common.select')}
                >
                    <Globe
                        className={`h-4 w-4 shrink-0 ${toolbar ? 'text-slate-300' : 'text-blue-600 dark:text-blue-400'}`}
                    />
                    <span className="hidden md:inline">
                        {currentLanguage.nativeName}
                    </span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl">
                {languages.map((language) => (
                    <DropdownMenuItem
                        key={language.code}
                        onClick={() => changeLanguage(language.code)}
                        className={`cursor-pointer ${i18n.language === language.code
                            ? 'bg-gray-100 dark:bg-gray-800 font-semibold'
                            : ''
                            }`}
                    >
                        <div className="flex flex-col">
                            <span className="font-medium">{language.nativeName}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {t(`languages.${language.code}`)}

                            </span>
                        </div>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
