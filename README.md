# Jira board

The active sprint of a Jira board for [EdgeStation](https://github.com/chainlist/edgestation),
column by column, as Jira shows it. It works with Jira Cloud and with Jira Data Center or Server.

- **Tap** a card to read the issue: its type, status, assignee, reporter, priority and
  description.
- **Hold** a card until it lifts, then drag it to another column to move the issue. The widget
  uses the first transition that goes to a status of that column. A transition that asks for
  more fields fails with Jira's message: make that move in Jira.

The board loads again every minute while its page shows. It shows Scrum boards: a Kanban board
has no sprint.

## Settings

| Setting       | What to enter                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board address | The address of the board in your browser, such as `https://your-site.atlassian.net/jira/software/projects/KEY/boards/1`.                                                    |
| Email         | Jira Cloud only: the email of your Atlassian account. Leave it empty for Data Center or Server.                                                                             |
| Token         | Jira Cloud: an [API token](https://id.atlassian.com/manage-profile/security/api-tokens). Data Center or Server: a personal access token (Profile → Personal Access Tokens). |

The widget acts as you: it sees and moves only what your account can. The settings hide the
token on screen in recent versions of EdgeStation, but EdgeStation saves it as plain text in its
settings file.
