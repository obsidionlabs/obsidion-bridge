import { redirect } from "next/navigation"

export default function Home() {
  redirect("/create")
  return null
}
