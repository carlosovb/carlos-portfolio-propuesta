(() => {
  const get = (id) => document.getElementById(id);
  const shapes = {
    financial_trainee: ["M25 11H215V201H25Z", "ft"],
    financial_consultant: ["M20 13H150L162 27H188L222 59V201H20Z", "fc"],
    financial_consultant_senior_i: ["M20 13H165L222 57V76L208 86V101L222 111V201H20Z", "fcs-i"],
    financial_consultant_senior_ii: ["M20 13H165L222 57V68L208 78V89L222 99V112L208 122V133L222 143V201H20Z", "fcs-ii"],
    team_manager: ["M120 9L225 63L192 201H48L15 63Z", "ge"],
    zone_coordinator: ["M22 68L87 53V40L153 26V17L220 5V201H22Z", "cz"],
    agency_director: ["M20 60L57 17H183L220 60V201H20Z", "da"],
    regional_director: ["M20 59L52 31L120 12L188 31L220 59V201H20Z", "dr"],
    national_director: ["M55 6H185L199 20V194L188 203H52L41 194V20Z", "dn", "1"],
  };
  let gradientId = 0;
  let memberRequest = 0;
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function trophy(award) {
    const [shape, variant, insignia] = shapes[award.position_code] || shapes.financial_consultant;
    const glass = node("figure", "", "career-glass");
    glass.dataset.variant = variant;
    const visual = node("div", "", "career-glass-face");
    const id = "career-glass-" + ++gradientId;
    // Solo geometría interna. Los datos del consultor se insertan como texto.
    visual.innerHTML = `<svg viewBox="0 0 240 210" aria-hidden="true">
      <defs><linearGradient id="${id}" x2="1" y2="1">
        <stop stop-color="#c9eaff" stop-opacity=".3"/>
        <stop offset=".48" stop-color="#354b67" stop-opacity=".22"/>
        <stop offset="1" stop-color="#a3d7ff" stop-opacity=".23"/>
      </linearGradient></defs>
      <path d="${shape}" fill="url(#${id})" stroke="currentColor" stroke-width="3"/>
      <path d="${shape}" fill="none" stroke="#eef7ff" stroke-opacity=".38"
        stroke-width="2" transform="translate(5 5) scale(.96 .95)"/>
    </svg>`;
    const engraving = node("figcaption", "", "career-glass-engraving");
    const brand = node("span", "", "career-glass-brand");
    brand.innerHTML = '<svg width="30" height="23" viewBox="0 0 30 23" aria-hidden="true"><path fill="currentColor" d="M1 22V13l7-3v12zm10 0V8l7-3v17zm10 0V4l7-3v21z"/></svg>OVB';
    engraving.append(brand, node("small", "Enhorabuena"), node("strong", award.name), node("b", award.position));
    if (insignia) {
      const badge = node("span", insignia, "career-glass-insignia");
      badge.setAttribute("aria-hidden", "true");
      visual.append(badge);
    }
    visual.append(engraving);
    glass.append(visual, node("div", "", "career-glass-base"));
    return glass;
  }
  function showCelebration(award, detail = "", animate = false) {
    const dialog = get("career-promotion-dialog");
    dialog.dataset.animate = String(animate);
    get("career-promotion-trophy").replaceChildren(trophy(award));
    get("career-promotion-title").textContent = "¡Enhorabuena por tu ascenso!";
    get("career-promotion-detail").textContent = detail || "Tu nuevo logro queda en la vitrina de Equipo.";
    if (!dialog.open) dialog.showModal();
  }
  async function showMember(userId, current) {
    const request = ++memberRequest;
    const host = get("team-member-trophies");
    host.hidden = true;
    host.replaceChildren();
    let awards;
    try {
      awards = await window.PortfolioBackend.panelQuery("list_career_trophies", { p_user: userId });
    } catch {
      return;
    }
    if (request !== memberRequest || !current() || !Array.isArray(awards) || !awards.length) return;
    host.append(node("p", "Plan de carrera", "eyebrow"),
      node("h3", "Vitrina de logros"));
    const shelf = node("div", "", "career-trophy-grid");
    for (const award of awards) {
      const item = node("div", "", "career-trophy-item");
      item.append(trophy(award));
      shelf.append(item);
    }
    host.append(shelf);
    host.hidden = false;
  }
  window.CareerTrophies = { showCelebration, showMember };
})();
