module SumofficeWopi
  # Adds "Open in SumOffice" next to .xlsx/.xlsm/.xlsb/.docx attachments on any page
  # that lists attachments (issues, documents, wiki, files).
  class Hooks < Redmine::Hook::ViewListener
    def view_layouts_base_html_head(context = {})
      javascript_include_tag('sumoffice', plugin: 'sumoffice_wopi')
    end
  end
end
