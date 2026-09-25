# SumOffice for Redmine — the WOPI host side: tokens, discovery, proof keys, locks.
#
# Redmine is the WOPI host (storage), SumOffice is the WOPI client (editor). Every
# callback runs with the rights of the person who opened the file: the token carries
# their user id, and access goes through Redmine's own checks (Attachment#visible?,
# Attachment#editable?).
require 'openssl'
require 'base64'
require 'json'
require 'net/http'
require 'uri'

module SumofficeWopi
  EXTENSIONS = %w[xlsx xlsm xlsb docx].freeze
  TOKEN_TTL = 10 * 3600
  LOCK_TTL = 30 * 60        # MS-WOPI: 30 minutes
  PROOF_WINDOW = 20 * 60    # MS-WOPI: 20 minutes of clock skew
  DISCOVERY_TTL = 3600

  module_function

  def settings
    Setting.plugin_sumoffice_wopi || {}
  end

  def extension(filename)
    File.extname(filename.to_s).delete('.').downcase
  end

  def supported?(attachment)
    EXTENSIONS.include?(extension(attachment.filename))
  end

  # ---- token -----------------------------------------------------------------

  def b64(data)
    Base64.urlsafe_encode64(data, padding: false)
  end

  def secret
    "sumoffice-wopi:#{Rails.application.secret_key_base}"
  end

  def make_token(user, attachment, can_write)
    expires = Time.now.to_i + TOKEN_TTL
    body = b64({ u: user.id, a: attachment.id, w: can_write ? 1 : 0, e: expires }.to_json)
    ["#{body}.#{b64(OpenSSL::HMAC.digest('SHA256', secret, body))}", expires]
  end

  def read_token(token, attachment_id)
    body, mac = token.to_s.split('.', 2)
    return nil if body.nil? || mac.nil?
    expected = b64(OpenSSL::HMAC.digest('SHA256', secret, body))
    return nil unless ActiveSupport::SecurityUtils.secure_compare(expected, mac)
    payload = JSON.parse(Base64.urlsafe_decode64(body))
    return nil unless payload['a'].to_i == attachment_id.to_i && payload['e'].to_i > Time.now.to_i
    payload
  rescue ArgumentError, JSON::ParserError
    nil
  end

  # ---- discovery and proof keys ---------------------------------------------

  def discovery
    url = settings['discovery_url'].to_s
    return nil if url.empty?
    Rails.cache.fetch("sumoffice_wopi/discovery/#{url}", expires_in: DISCOVERY_TTL) do
      uri = URI(url)
      res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 10, read_timeout: 15) { |h| h.get(uri.request_uri) }
      raise "discovery: #{res.code}" unless res.is_a?(Net::HTTPSuccess)
      doc = res.body
      actions = {}
      doc.scan(/<action\b([^>]*)>/).each do |(attrs)|
        a = Hash[attrs.scan(/([\w-]+)="([^"]*)"/)]
        ext = a['ext'].to_s.downcase
        next if ext.empty? || a['name'].to_s.empty? || a['urlsrc'].to_s.empty?
        key = "#{ext}|#{a['name']}"
        actions[key] ||= CGI.unescapeHTML(a['urlsrc']).gsub(/<[^>]*>/, '')
      end
      pk = doc[/<proof-key\b([^>]*)>/, 1]
      proof = pk ? Hash[pk.scan(/([\w-]+)="([^"]*)"/)] : nil
      { 'actions' => actions, 'proof' => proof }
    end
  end

  def rsa_key(modulus, exponent)
    n = OpenSSL::BN.new(Base64.decode64(modulus), 2)
    e = OpenSSL::BN.new(Base64.decode64(exponent), 2)
    seq = OpenSSL::ASN1::Sequence([OpenSSL::ASN1::Integer(n), OpenSSL::ASN1::Integer(e)])
    OpenSSL::PKey::RSA.new(seq.to_der)
  end

  def proof_ok?(request, token)
    return true if settings['verify_proof'].to_s == '0'
    keys = discovery && discovery['proof']
    return false unless keys && keys['modulus']
    ticks = request.headers['X-WOPI-TimeStamp'].to_s
    proof = request.headers['X-WOPI-Proof'].to_s
    proof_old = request.headers['X-WOPI-ProofOld'].to_s
    return false unless ticks =~ /\A\d+\z/ && !proof.empty?
    return false if (Time.now.to_i - (ticks.to_i - 621_355_968_000_000_000) / 10_000_000).abs > PROOF_WINDOW
    url = "#{request.base_url}#{request.fullpath}".upcase
    data = [token.bytesize].pack('N') + token + [url.bytesize].pack('N') + url + [8].pack('N') + [ticks.to_i].pack('Q>')
    check = lambda do |key, sig|
      !sig.empty? && key.verify(OpenSSL::Digest.new('SHA256'), Base64.decode64(sig), data)
    rescue OpenSSL::PKey::PKeyError
      false
    end
    current = rsa_key(keys['modulus'], keys['exponent'])
    return true if check.call(current, proof) || check.call(current, proof_old)
    keys['oldmodulus'] && keys['oldexponent'] && check.call(rsa_key(keys['oldmodulus'], keys['oldexponent']), proof)
  end

  # ---- locks -------------------------------------------------------------------

  def lock_key(attachment_id)
    "sumoffice_wopi/lock/#{attachment_id}"
  end

  def lock(attachment_id)
    Rails.cache.read(lock_key(attachment_id))
  end

  def set_lock(attachment_id, value)
    if value.nil?
      Rails.cache.delete(lock_key(attachment_id))
    else
      Rails.cache.write(lock_key(attachment_id), value, expires_in: LOCK_TTL)
    end
  end
end
