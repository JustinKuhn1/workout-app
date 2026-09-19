//This app.js file acts as a shared supabase setup that will be used by every page.
//Load order in HTML file: supabase-js CDN -> config.js, then app.js (this file)
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function requireSession() {
    const { data } = await db.auth.getSession();
    if(!data.session) window.location.href = "index.html";
    return data.session;
}

async function logOut() {
    await db.auth.signOut();
    window.location.href = "index.html";
}

// Show an error message within an element
//We call it with no message to hide the element
function showError(element, message = "") {
    element.textContent = message;
    element.hidden = !message;
}

//creates an element with an option CSS class and text
//text is set within textContent, so it is never treated as HTML
function el(tag, className = "", text = "") {
    const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

//This function asks the API for a plan, then saves the answers and the plan on the user's profile (in db)
//Used by both the questionnaire and the dashboard's "Regenerate plan" button.
async function generateAndSavePlan(userId, answers) {
    const response = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(answers),
    });

    if (!response.ok) throw new Error("The plan API returned " + response.status);

    // CHANGED: "plan" was used in the upsert below but never defined, so this threw a ReferenceError
    // and nothing was ever saved to the profiles table.
    const plan = await response.json();

    const {error} = await db
        .from("profiles")
        .upsert({id: userId, answers, plan, updated_at: new Date().toISOString()});
        if (error) throw error;
    
}