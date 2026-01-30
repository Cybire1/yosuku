import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                "aleo-blue": "var(--color-aleo-blue)",
                "aleo-mint": "var(--color-aleo-mint)",
                "aleo-pink": "var(--color-aleo-pink)",
                "aleo-orange": "var(--color-aleo-orange)",
                "off-blue": "var(--color-off-blue)",
                "off-red": "var(--color-off-red)",
                "off-green": "var(--color-off-green)",
                "new-blue": "var(--color-new-blue)",
                "new-mint": "var(--color-new-mint)",
                "new-pink": "var(--color-new-pink)",
                "new-orange": "var(--color-new-orange)",
            },
        },
    },
    plugins: [],
};

export default config;
