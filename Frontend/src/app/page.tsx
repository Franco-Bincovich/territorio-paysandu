import { TerritoryApp } from "../components/territory-app";
import { connection } from 'next/server';
export default async function Page() {
  await connection();
  return <TerritoryApp />;
}
