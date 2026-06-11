pub mod accounts;
pub mod content;
pub mod instances;
pub mod launch;
pub mod modrinth;
pub mod settings;
pub mod versions;

pub type CmdResult<T> = Result<T, String>;

pub fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
