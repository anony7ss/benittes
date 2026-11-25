export function Intro({
  label,
  title,
  desc,
}: {
  label: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="intro">
      <span className="kicker">{label}</span>
      <h1>
        {title}
        <em>.</em>
      </h1>
      {desc && <p>{desc}</p>}
    </div>
  );
}
