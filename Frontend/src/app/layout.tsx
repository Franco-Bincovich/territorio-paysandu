import type { Metadata } from "next";
import "./globals.css";
import "./prototype-art.css";
export const metadata: Metadata = {
  title: "Territorio Paysandú",
  description: "Consulta territorial y registro de consultas",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-UY">
      <body>{children}</body>
    </html>
  );
}
