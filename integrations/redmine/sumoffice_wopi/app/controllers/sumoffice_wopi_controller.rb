# /sumoffice/open/:id                 the signed-in person opens an attachment (auto-post form)
# /sumoffice/wopi/files/:id            CheckFileInfo (GET), LOCK/UNLOCK/REFRESH_LOCK/GET_LOCK (POST)
# /sumoffice/wopi/files/:id/contents   GetFile (GET), PutFile (POST, X-WOPI-Override: PUT)
class SumofficeWopiController < ApplicationController
  skip_before_action :check_if_login_required, :verify_authenticity_token, except: :open
  skip_before_action :session_expiration, :user_setup, :set_localization, raise: false, except: :open
  before_action :find_attachment
  before_action :wopi_auth, except: :open

  def open
    return render_403 unless @attachment.visible?(User.current)
    ext = SumofficeWopi.extension(@attachment.filename)
    return render_error(message: "SumOffice does not open .#{ext} files.", status: 415) unless SumofficeWopi.supported?(@attachment)
    d = SumofficeWopi.discovery
    return render_error(message: 'SumOffice is not configured: set the discovery URL in the plugin settings.', status: 503) unless d
    can_write = @attachment.editable?(User.current)
    action = d['actions']["#{ext}|#{can_write ? 'edit' : 'view'}"] || d['actions']["#{ext}|edit"]
    return render_error(message: "SumOffice discovery has no action for .#{ext}.", status: 503) unless action
    wopi_src = "#{request.base_url}#{Redmine::Utils.relative_url_root}/sumoffice/wopi/files/#{@attachment.id}"
    sep = action.end_with?('?', '&') ? '' : (action.include?('?') ? '&' : '?')
    token, expires = SumofficeWopi.make_token(User.current, @attachment, can_write)
    @target = "#{action}#{sep}WOPISrc=#{CGI.escape(wopi_src)}"
    @token = token
    @ttl = expires * 1000
    render inline: <<~HTML, layout: false
      <!doctype html><meta charset="utf-8"><title><%= @attachment.filename %></title>
      <style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
      <form id="f" method="post" target="ed" action="<%= @target %>">
      <input type="hidden" name="access_token" value="<%= @token %>"><input type="hidden" name="access_token_ttl" value="<%= @ttl %>"></form>
      <iframe name="ed" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
      <%= javascript_tag 'document.getElementById("f").submit()' %>
    HTML
  end

  def check_file_info
    render json: {
      BaseFileName: @attachment.filename,
      Size: File.size?(@attachment.diskfile).to_i,
      OwnerId: @attachment.author_id.to_s,
      UserId: @user.id.to_s,
      UserFriendlyName: @user.name,
      Version: @attachment.digest.to_s,
      UserCanWrite: @can_write,
      ReadOnly: !@can_write,
      UserCanNotWriteRelative: true,
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsUpdate: true,
      PostMessageOrigin: request.base_url
    }
  end

  def get_file
    send_file @attachment.diskfile, filename: @attachment.filename, type: 'application/octet-stream', disposition: 'attachment'
  end

  def put_file
    return head(:bad_request) unless request.headers['X-WOPI-Override'] == 'PUT'
    return head(:unauthorized) unless @can_write
    lock = SumofficeWopi.lock(@attachment.id)
    sent = request.headers['X-WOPI-Lock'].to_s
    if lock ? lock != sent : File.size?(@attachment.diskfile).to_i.positive?
      response.headers['X-WOPI-Lock'] = lock.to_s
      return head(:conflict)
    end
    data = request.raw_post
    File.binwrite(@attachment.diskfile, data)
    @attachment.update_columns(filesize: data.bytesize, digest: Digest::SHA256.hexdigest(data))
    response.headers['X-WOPI-ItemVersion'] = @attachment.digest.to_s
    head :ok
  end

  def file_operation
    op = request.headers['X-WOPI-Override'].to_s
    sent = request.headers['X-WOPI-Lock'].to_s
    lock = SumofficeWopi.lock(@attachment.id)
    if op == 'GET_LOCK'
      response.headers['X-WOPI-Lock'] = lock.to_s
      return head(:ok)
    end
    return head(:not_implemented) unless %w[LOCK UNLOCK REFRESH_LOCK].include?(op)
    return head(:unauthorized) unless @can_write
    if op == 'LOCK'
      old = request.headers['X-WOPI-OldLock']
      if lock && lock != sent && lock != old
        response.headers['X-WOPI-Lock'] = lock
        return head(:conflict)
      end
      SumofficeWopi.set_lock(@attachment.id, sent)
      return head(:ok)
    end
    if lock.nil? || lock != sent
      response.headers['X-WOPI-Lock'] = lock.to_s
      return head(:conflict)
    end
    SumofficeWopi.set_lock(@attachment.id, op == 'UNLOCK' ? nil : sent)
    head :ok
  end

  private

  def find_attachment
    @attachment = Attachment.find_by(id: params[:id])
    head(:not_found) unless @attachment
  end

  def wopi_auth
    token = params[:access_token].to_s
    payload = SumofficeWopi.read_token(token, @attachment.id)
    return head(:unauthorized) unless payload
    return head(:internal_server_error) unless SumofficeWopi.proof_ok?(request, token)
    @user = User.active.find_by(id: payload['u'])
    return head(:unauthorized) unless @user && @attachment.visible?(@user)
    @can_write = payload['w'].to_i == 1 && @attachment.editable?(@user)
  end
end
