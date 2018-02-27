import React, { Component } from 'react'
import { connect as reduxConnect } from 'react-redux'

import { getQueryFromStore } from './store'

const connect = (query, options = {}) => WrappedComponent => {
  const mapStateToProps = (state, ownProps) => ({
    ...getQueryFromStore(state, ownProps.queryId)
  })

  const ConnectedWrappedComponent = reduxConnect(mapStateToProps)(
    WrappedComponent
  )

  class Wrapper extends Component {
    componentWillMount() {
      const { client } = this.context
      this.queryId = options.as || client.generateId()
      client.query(query, { as: this.queryId })
    }

    render() {
      return (
        <ConnectedWrappedComponent queryId={this.queryId} {...this.props} />
      )
    }
  }

  Wrapper.displayName = `CozyConnect(${WrappedComponent.displayName ||
    WrappedComponent.name ||
    'Component'})`
  return Wrapper
}

export default connect
