import { LinkButton } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/states";

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="Nothing here"
      body="That page or battle doesn't exist, or it's been taken down."
      actions={
        <>
          <LinkButton href="/discover">Discover battles</LinkButton>
          <LinkButton href="/" variant="ghost">
            Home
          </LinkButton>
        </>
      }
    />
  );
}
