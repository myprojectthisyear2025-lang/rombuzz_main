// frontend/src/components/Footer.jsx
// Purpose: Shared RomBuzz website footer with working legal and contact links.


export default function Footer() {
  return (
    <footer className="bg-gray-800 text-white text-center py-4 px-6 mt-auto relative z-40">
      <p className="text-sm">
        © {new Date().getFullYear()}{" "}
        <span className="font-semibold">RomBuzz</span>. All rights reserved.
      </p>

      <div className="flex flex-wrap justify-center gap-6 mt-2 text-sm">
        <a
          href="/privacy"
          className="hover:text-rose-300 transition-colors"
        >
          Privacy
        </a>

        <a
          href="/terms"
          className="hover:text-rose-300 transition-colors"
        >
          Terms
        </a>

        <a
          href="/delete-account"
          className="hover:text-rose-300 transition-colors"
        >
          Delete Account
        </a>

        <a
          href="mailto:legal@neptrixx.com"
          className="hover:text-rose-300 transition-colors"
        >
          Contact
        </a>
      </div>
    </footer>
  );
}